pub fn log_session(token: &str) {
    tracing::info!(token = token, "session restored");
}
