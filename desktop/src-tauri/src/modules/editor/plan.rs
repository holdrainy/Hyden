use super::models::{EditorError, EditorTrimRequest, FFmpegPlan, InputKind};

/// POSIX display/copy only. A future executor must pass `args` directly to Command.
pub fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn seconds(value: f64) -> String {
    // Match the browser's explicit millisecond quantization (positive, finite input).
    format!("{:.3}", (value * 1000.0).round() / 1000.0)
}

pub fn create_trim_plan(request: &EditorTrimRequest) -> Result<FFmpegPlan, EditorError> {
    let name = &request.input_name;
    if name.trim().is_empty()
        || name.encode_utf16().count() > 200
        || matches!(name.trim(), "." | "..")
        || name.chars().any(|character| {
            matches!(character, '/' | '\\' | ':') || character <= '\u{001f}' || character == '\u{007f}'
        })
    {
        return Err(EditorError::validation("Choose a local file with a basename of at most 200 characters, without path separators, colons, or control characters."));
    }
    let duration = request.duration_seconds;
    let start = request.start_seconds;
    let end = request.end_seconds;
    if !duration.is_finite() || !start.is_finite() || !end.is_finite()
        || duration <= 0.0 || duration > 86400.0 || start < 0.0 || end > duration
        || end - start + 1e-9 < 0.05
    {
        return Err(EditorError::validation("Choose a range of at least 0.05 seconds within the media duration (maximum 24 hours)."));
    }
    let audio_only = request.audio_only || matches!(request.input_kind, InputKind::Audio);
    let base = name.rsplit_once('.').map(|(stem, _)| stem).unwrap_or(name);
    let safe: String = base.chars().map(|character| {
        if character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | ' ' | '-') {
            character
        } else {
            '_'
        }
    }).collect();
    let stem: String = safe.trim_matches(|character| character == '.' || character == ' ').chars().take(120).collect();
    let stem = if stem.is_empty() { "media" } else { &stem };
    let output_name = format!("{stem}{}", if audio_only { "-audio.mp3" } else { "-trimmed.mp4" });
    let mut args = vec![
        "-nostdin".to_owned(), "-n".to_owned(), "-ss".to_owned(), seconds(start),
        "-i".to_owned(), format!("./{name}"), "-t".to_owned(), seconds(end - start),
    ];
    let options: &[&str] = if audio_only {
        &["-vn", "-c:a", "libmp3lame", "-q:a", "2"]
    } else {
        &["-map", "0:v:0?", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-movflags", "+faststart"]
    };
    args.extend(options.iter().map(|value| (*value).to_owned()));
    args.push(format!("./{output_name}"));
    let mut display = vec![shell_quote("ffmpeg")];
    display.extend(args.iter().map(|argument| shell_quote(argument)));
    Ok(FFmpegPlan {
        program: "ffmpeg", args, display_command: display.join(" "), output_name, mode: "plan-only",
        notice: "Command plan only. No media has been processed. Run the reviewed command beside your input file on a computer with the required FFmpeg codecs; native execution needs an approved local file workflow.",
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> EditorTrimRequest {
        EditorTrimRequest {
            input_name: "holiday clip.webm".to_owned(), input_kind: InputKind::Video,
            duration_seconds: 60.0, start_seconds: 5.0, end_seconds: 15.25, audio_only: false,
        }
    }

    #[test]
    fn plans_non_overwriting_video_reencoding_with_exact_relative_argv() {
        let plan = create_trim_plan(&request()).unwrap();
        assert_eq!(plan.output_name, "holiday clip-trimmed.mp4");
        assert_eq!(&plan.args[..8], ["-nostdin", "-n", "-ss", "5.000", "-i", "./holiday clip.webm", "-t", "10.250"]);
        assert!(plan.args.contains(&"libx264".to_owned()));
        assert!(!plan.args.contains(&"-y".to_owned()));
        assert!(!plan.args.contains(&"copy".to_owned()));
    }

    #[test]
    fn audio_inputs_force_mp3_and_quotes_never_change_argument_identity() {
        let mut input = request();
        input.input_kind = InputKind::Audio;
        input.input_name = "-a'b $(touch BAD);`id`.wav".to_owned();
        let plan = create_trim_plan(&input).unwrap();
        assert!(plan.output_name.ends_with("-audio.mp3"));
        assert_eq!(plan.args[5], "./-a'b $(touch BAD);`id`.wav");
        assert_eq!(shell_quote("a'b"), r#"'a'\''b'"#);
    }

    #[test]
    fn rejects_paths_bad_ranges_and_nonfinite_values() {
        for name in ["", " ", ".", "..", "../clip.mp4", "C:\\clip.mp4", "https://example.com/a", "clip\n.mp4"] {
            let mut input = request(); input.input_name = name.to_owned();
            assert!(create_trim_plan(&input).is_err());
        }
        for start in [-1.0, 16.0, f64::NAN, f64::INFINITY] {
            let mut input = request(); input.start_seconds = start;
            assert!(create_trim_plan(&input).is_err());
        }
        let mut input = request(); input.duration_seconds = 86401.0;
        assert!(create_trim_plan(&input).is_err());
        let mut input = request(); input.end_seconds = 5.01;
        assert!(create_trim_plan(&input).is_err());
    }

    #[test]
    fn quantization_matches_browser_ties_and_sanitizes_unicode_output_names() {
        let mut input = request(); input.input_name = "🎧 clip.wav".to_owned();
        input.start_seconds = 1.0625; input.end_seconds = 2.125;
        let plan = create_trim_plan(&input).unwrap();
        assert_eq!(plan.args[3], "1.063");
        assert_eq!(plan.args[7], "1.063");
        assert_eq!(plan.output_name, "_ clip-trimmed.mp4");
    }
}
