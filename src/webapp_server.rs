use anyhow::Result;
use axum::Router;
use std::net::SocketAddr;
use std::path::PathBuf;
use tower_http::services::{ServeDir, ServeFile};
use tracing::{info, warn};

pub const DEFAULT_WEBAPPS_DIR: &str = "/opt/nocturne/webapps/ui";
pub const DEFAULT_LISTEN: &str = "127.0.0.1:8080";

pub async fn run(addr: SocketAddr, webapps_dir: PathBuf) -> Result<()> {
    if !webapps_dir.exists() {
        warn!(
            "Webapps directory {} does not exist; static server not started",
            webapps_dir.display()
        );
        return Ok(());
    }

    let index = webapps_dir.join("index.html");
    let serve_dir = ServeDir::new(&webapps_dir).not_found_service(ServeFile::new(&index));

    let app = Router::new().fallback_service(serve_dir);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    info!(
        "Webapp HTTP server listening on http://{} (root: {})",
        addr,
        webapps_dir.display()
    );
    axum::serve(listener, app).await?;
    Ok(())
}
