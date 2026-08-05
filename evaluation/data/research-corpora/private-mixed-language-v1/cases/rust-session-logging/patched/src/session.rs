pub fn log_session(token: &str) {
    tracing::info!(token_present = !token.is_empty(), "session restored");
}
