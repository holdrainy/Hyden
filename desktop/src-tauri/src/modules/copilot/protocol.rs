//! Bounded decoding for Ollama NDJSON and OpenAI-compatible llama.cpp SSE.
//! Bytes are retained until a complete line arrives, so transport chunk boundaries
//! cannot split UTF-8 text or accidentally turn an incomplete stream into success.

use serde_json::Value;

use super::models::{CopilotError, Provider};

const MAX_FRAME_BYTES: usize = 256 * 1024;
const MAX_RESPONSE_BYTES: usize = 64 * 1024;

#[derive(Debug, PartialEq)]
pub enum StreamPiece {
    Delta(String),
    Done,
}

pub struct StreamDecoder {
    provider: Provider,
    line: Vec<u8>,
    event_data: String,
    event_bytes: usize,
    response_bytes: usize,
    done: bool,
}

impl StreamDecoder {
    pub fn new(provider: Provider) -> Self {
        Self {
            provider,
            line: Vec::new(),
            event_data: String::new(),
            event_bytes: 0,
            response_bytes: 0,
            done: false,
        }
    }

    pub fn push(&mut self, bytes: &[u8]) -> Result<Vec<StreamPiece>, CopilotError> {
        let mut output = Vec::new();
        let mut start = 0;
        for (index, byte) in bytes.iter().enumerate() {
            if *byte != b'\n' {
                continue;
            }
            self.append_line(&bytes[start..index])?;
            let line = std::mem::take(&mut self.line);
            self.process_line(&line, &mut output)?;
            start = index + 1;
        }
        self.append_line(&bytes[start..])?;
        Ok(output)
    }

    pub fn finish(&mut self) -> Result<Vec<StreamPiece>, CopilotError> {
        let mut output = Vec::new();
        if !self.line.is_empty() {
            let line = std::mem::take(&mut self.line);
            self.process_line(&line, &mut output)?;
        }
        if matches!(self.provider, Provider::Llamacpp) && !self.event_data.is_empty() {
            self.process_sse_event(&mut output)?;
        }
        if !self.done {
            return Err(CopilotError::new(
                "INCOMPLETE_STREAM",
                "The local runner closed the response before its completion marker. The reply may be incomplete.",
            ));
        }
        Ok(output)
    }

    fn append_line(&mut self, bytes: &[u8]) -> Result<(), CopilotError> {
        if self.done {
            if bytes.iter().any(|byte| !byte.is_ascii_whitespace()) {
                return Err(protocol_error("The runner sent data after its completion marker."));
            }
            return Ok(());
        }
        if self.line.len().saturating_add(bytes.len()) > MAX_FRAME_BYTES {
            return Err(limit_error());
        }
        self.line.extend_from_slice(bytes);
        Ok(())
    }

    fn process_line(
        &mut self,
        bytes: &[u8],
        output: &mut Vec<StreamPiece>,
    ) -> Result<(), CopilotError> {
        let bytes = bytes.strip_suffix(b"\r").unwrap_or(bytes);
        let line = std::str::from_utf8(bytes)
            .map_err(|_| protocol_error("The local runner returned invalid UTF-8 text."))?;
        if self.done {
            if !line.trim().is_empty() {
                return Err(protocol_error("The runner sent data after its completion marker."));
            }
            return Ok(());
        }
        match self.provider {
            Provider::Ollama => self.process_ollama(line, output),
            Provider::Llamacpp => {
                if line.is_empty() {
                    self.event_bytes = 0;
                    return self.process_sse_event(output);
                }
                self.event_bytes = self.event_bytes.saturating_add(bytes.len() + 1);
                if self.event_bytes > MAX_FRAME_BYTES {
                    return Err(limit_error());
                }
                if let Some(data) = line.strip_prefix("data:") {
                    let data = data.strip_prefix(' ').unwrap_or(data);
                    if !self.event_data.is_empty() {
                        self.event_data.push('\n');
                    }
                    self.event_data.push_str(data);
                }
                // SSE comments, event IDs, retry advice, and unrecognized fields
                // have no authority over the native command or transport.
                Ok(())
            }
        }
    }

    fn process_ollama(
        &mut self,
        line: &str,
        output: &mut Vec<StreamPiece>,
    ) -> Result<(), CopilotError> {
        if line.trim().is_empty() {
            return Ok(());
        }
        let value: Value = serde_json::from_str(line)
            .map_err(|_| protocol_error("The local runner returned a malformed JSON stream record."))?;
        check_runner_error(&value)?;
        let done = value.get("done").and_then(Value::as_bool)
            .ok_or_else(|| protocol_error("An Ollama response record has no valid completion flag."))?;
        if let Some(message) = value.get("message") {
            let message = message.as_object()
                .ok_or_else(|| protocol_error("An Ollama response message is malformed."))?;
            if let Some(content) = message.get("content") {
                if !content.is_null() {
                    let delta = content.as_str()
                        .ok_or_else(|| protocol_error("An Ollama response token is not text."))?;
                    self.delta(delta, output)?;
                }
            }
        } else if !done {
            return Err(protocol_error("An Ollama response record has no message."));
        }
        if done {
            self.done = true;
            output.push(StreamPiece::Done);
        }
        Ok(())
    }

    fn process_sse_event(&mut self, output: &mut Vec<StreamPiece>) -> Result<(), CopilotError> {
        let data = std::mem::take(&mut self.event_data);
        self.event_bytes = 0;
        if data.trim().is_empty() {
            return Ok(());
        }
        if data.trim() == "[DONE]" {
            self.done = true;
            output.push(StreamPiece::Done);
            return Ok(());
        }
        let value: Value = serde_json::from_str(&data)
            .map_err(|_| protocol_error("The local runner returned a malformed SSE JSON event."))?;
        check_runner_error(&value)?;
        let choices = value.get("choices").and_then(Value::as_array)
            .ok_or_else(|| protocol_error("A chat stream event has no valid choices array."))?;
        // This application requests the default single completion. Never merge
        // independent choices into one assistant message.
        if let Some(choice) = choices.first() {
            let choice = choice.as_object()
                .ok_or_else(|| protocol_error("A chat stream choice is malformed."))?;
            if let Some(delta) = choice.get("delta") {
                let delta = delta.as_object()
                    .ok_or_else(|| protocol_error("A chat stream delta is malformed."))?;
                if let Some(content) = delta.get("content") {
                    if !content.is_null() {
                        let text = content.as_str()
                            .ok_or_else(|| protocol_error("A chat stream token is not text."))?;
                        self.delta(text, output)?;
                    }
                }
            } else if choice.get("finish_reason").is_none_or(Value::is_null) {
                return Err(protocol_error("A chat stream choice has no delta or finish reason."));
            }
        }
        // A finish_reason is metadata, not the SSE transport's terminal marker.
        // EOF before [DONE] is still reported as an incomplete response.
        Ok(())
    }

    fn delta(&mut self, text: &str, output: &mut Vec<StreamPiece>) -> Result<(), CopilotError> {
        if text.is_empty() {
            return Ok(());
        }
        self.response_bytes = self.response_bytes.saturating_add(text.len());
        if self.response_bytes > MAX_RESPONSE_BYTES {
            return Err(CopilotError::new(
                "RESPONSE_LIMIT",
                "The reply exceeded the 64 KiB response limit. Stop here and ask a more focused question.",
            ));
        }
        output.push(StreamPiece::Delta(text.to_owned()));
        Ok(())
    }
}

fn protocol_error(message: &str) -> CopilotError {
    CopilotError::new("PROTOCOL_ERROR", message)
}

fn limit_error() -> CopilotError {
    CopilotError::new("RESPONSE_LIMIT", "A stream frame exceeded the 256 KiB safety limit.")
}

fn check_runner_error(value: &Value) -> Result<(), CopilotError> {
    if value.get("error").is_some_and(|error| !error.is_null()) {
        // Runner error payloads can contain local paths or arbitrary diagnostic
        // output. Return a bounded actionable error instead of echoing them.
        return Err(CopilotError::new(
            "RUNNER_ERROR",
            "The local runner reported a generation error. Check that the selected model is installed and inspect the runner's logs.",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ollama_handles_every_utf8_byte_boundary_and_empty_deltas() {
        let input = concat!(
            "{\"message\":{\"content\":\"\"},\"done\":false}\n",
            "{\"message\":{\"content\":\"مرحبا 🌧\"},\"done\":false}\n",
            "{\"done\":true}\n",
        );
        let mut decoder = StreamDecoder::new(Provider::Ollama);
        let mut pieces = Vec::new();
        for byte in input.as_bytes() {
            pieces.extend(decoder.push(&[*byte]).unwrap());
        }
        pieces.extend(decoder.finish().unwrap());
        assert_eq!(pieces, vec![StreamPiece::Delta("مرحبا 🌧".into()), StreamPiece::Done]);
    }

    #[test]
    fn ollama_final_record_may_end_without_a_newline() {
        let mut decoder = StreamDecoder::new(Provider::Ollama);
        assert!(decoder.push(b"{\"message\":{\"content\":\"done\"},\"done\":true}").unwrap().is_empty());
        assert_eq!(decoder.finish().unwrap(), vec![StreamPiece::Delta("done".into()), StreamPiece::Done]);
    }

    #[test]
    fn sse_handles_fragmented_crlf_comments_roles_and_multiple_data_fields() {
        let input = concat!(
            ": keepalive\r\n",
            "data: {\"choices\":[{\"delta\":{\"role\":\"assistant\"}}]}\r\n\r\n",
            "event: message\r\n",
            "data: {\"choices\":[\r\n",
            "data: {\"delta\":{\"content\":\"café\"}}]}\r\n\r\n",
            "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\r\n\r\n",
            "data: [DONE]\r\n\r\n",
        );
        let mut decoder = StreamDecoder::new(Provider::Llamacpp);
        let mut pieces = Vec::new();
        for part in input.as_bytes().chunks(2) {
            pieces.extend(decoder.push(part).unwrap());
        }
        pieces.extend(decoder.finish().unwrap());
        assert_eq!(pieces, vec![StreamPiece::Delta("café".into()), StreamPiece::Done]);
    }

    #[test]
    fn eof_never_substitutes_for_a_runner_completion_marker() {
        let mut ollama = StreamDecoder::new(Provider::Ollama);
        ollama.push(b"{\"message\":{\"content\":\"partial\"},\"done\":false}\n").unwrap();
        assert_eq!(ollama.finish().unwrap_err().code, "INCOMPLETE_STREAM");
        let mut sse = StreamDecoder::new(Provider::Llamacpp);
        sse.push(b"data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n").unwrap();
        assert_eq!(sse.finish().unwrap_err().code, "INCOMPLETE_STREAM");
    }

    #[test]
    fn malformed_and_server_errors_do_not_become_success() {
        let mut invalid = StreamDecoder::new(Provider::Ollama);
        assert_eq!(invalid.push(&[0xff, b'\n']).unwrap_err().code, "PROTOCOL_ERROR");
        let mut missing_flag = StreamDecoder::new(Provider::Ollama);
        assert_eq!(missing_flag.push(b"{\"message\":{\"content\":\"x\"}}\n").unwrap_err().code, "PROTOCOL_ERROR");
        let mut ollama = StreamDecoder::new(Provider::Ollama);
        assert_eq!(ollama.push(b"{\"error\":\"model missing\"}\n").unwrap_err().code, "RUNNER_ERROR");
        let mut sse = StreamDecoder::new(Provider::Llamacpp);
        assert_eq!(sse.push(b"data: {\"error\":{\"message\":\"missing\"}}\n\n").unwrap_err().code, "RUNNER_ERROR");
    }

    #[test]
    fn frame_and_visible_response_budgets_are_enforced() {
        let mut frame = StreamDecoder::new(Provider::Llamacpp);
        assert_eq!(frame.push(&vec![b'x'; MAX_FRAME_BYTES + 1]).unwrap_err().code, "RESPONSE_LIMIT");
        let mut reply = StreamDecoder::new(Provider::Ollama);
        let first = serde_json::json!({ "message": { "content": "a".repeat(40_000) }, "done": false }).to_string() + "\n";
        reply.push(first.as_bytes()).unwrap();
        let next = serde_json::json!({ "message": { "content": "b".repeat(30_000) }, "done": false }).to_string() + "\n";
        assert_eq!(reply.push(next.as_bytes()).unwrap_err().code, "RESPONSE_LIMIT");
    }

    #[test]
    fn trailing_content_after_completion_is_rejected() {
        let mut decoder = StreamDecoder::new(Provider::Ollama);
        assert_eq!(decoder.push(b"{\"done\":true}\n\n").unwrap(), vec![StreamPiece::Done]);
        assert!(decoder.push(b" \r\n").unwrap().is_empty());
        assert_eq!(decoder.push(b"{\"done\":false}\n").unwrap_err().code, "PROTOCOL_ERROR");
    }
}
