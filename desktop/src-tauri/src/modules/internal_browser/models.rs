use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserCapabilities {
    pub mode: &'static str,
    pub live_browsing: bool,
    pub cookie_access: bool,
    pub notice: &'static str,
}

#[derive(Debug, Serialize)]
pub struct BrowserError {
    pub code: &'static str,
    pub message: &'static str,
}
