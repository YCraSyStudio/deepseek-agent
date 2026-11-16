use reqwest::{redirect::Policy, Client, Method, Url};
use serde_json::Value;
use std::time::Duration;

const CONNECT_ERROR: &str = "No se pudo conectar al IDE del PC por HTTPS.";
const RESPONSE_ERROR: &str = "El PC no ha devuelto una respuesta válida del IDE móvil.";
const MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024;

#[tauri::command]
async fn mobile_request(
    client: tauri::State<'_, Client>,
    server: String,
    token: String,
    route: String,
    method: String,
    body: Option<Value>,
) -> Result<Value, String> {
    let mut target = Url::parse(&server).map_err(|_| "Introduce la URL HTTPS del PC.")?;
    if target.scheme() != "https"
        || target.host().is_none()
        || !target.username().is_empty()
        || target.password().is_some()
        || target.path() != "/"
        || target.query().is_some()
        || target.fragment().is_some()
    {
        return Err("Introduce la URL HTTPS del PC sin ruta ni credenciales.".into());
    }

    let (endpoint, query) = route.split_once('?').unwrap_or((&route, ""));
    let http_method = match (method.as_str(), endpoint) {
        ("GET", "files" | "file" | "changes" | "diff") => Method::GET,
        ("PUT", "file") => Method::PUT,
        ("POST", "chat") => Method::POST,
        _ => return Err("Operación del IDE desconocida.".into()),
    };
    target.set_path(&format!("/api/{endpoint}"));
    if !query.is_empty() {
        target.set_query(Some(query));
    }

    let mut request = client.request(http_method, target).bearer_auth(token);
    if let Some(body) = body {
        request = request.json(&body);
    }
    let mut response = request.send().await.map_err(|_| CONNECT_ERROR)?;
    if response.status().is_redirection() {
        return Err("La URL redirige a otro sitio. Usa la URL final del IDE.".into());
    }
    let status = response.status();
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| CONNECT_ERROR)? {
        if bytes.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return Err("La respuesta del IDE supera el tamaño admitido.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let result: Value = serde_json::from_slice(&bytes).map_err(|_| RESPONSE_ERROR)?;
    if !status.is_success() {
        return Err(result.get("error").and_then(Value::as_str).unwrap_or(RESPONSE_ERROR).into());
    }
    Ok(result)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let client = Client::builder()
        .redirect(Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(100))
        .build()
        .expect("could not initialize the mobile HTTP client");
    tauri::Builder::default()
        .manage(client)
        .invoke_handler(tauri::generate_handler![mobile_request])
        .run(tauri::generate_context!())
        .expect("could not start DeepSeek Agent Mobile");
}
