use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{fs, process::Command, ptr, slice, sync::Mutex, thread, time::Duration};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
    image::Image,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
};
use windows_sys::Win32::{
    Foundation::LocalFree,
    Graphics::Dwm::{
        DWMWA_BORDER_COLOR, DWMWA_CAPTION_COLOR, DWMWA_TEXT_COLOR, DWMWA_WINDOW_CORNER_PREFERENCE,
        DWMWCP_ROUND, DwmSetWindowAttribute,
    },
    Security::Cryptography::{
        CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData, CryptUnprotectData,
    },
};

const PET_WINDOW_LABEL: &str = "pet";
const SETTINGS_WINDOW_LABEL: &str = "settings";
const API_KEY_FILE_NAME: &str = "chat-api-key.dpapi";
const LEGACY_CHAT_MEMORY_FILE_NAME: &str = "chat-memory.dpapi";
const MAX_CHAT_MEMORY_BYTES: usize = 64 * 1024;
const SETTINGS_ICON_BYTES: &[u8] =
    include_bytes!("../../../../pets/official/cyrene-live2d/assets/tray-icon.png");
const CURSOR_SAMPLE_INTERVAL: Duration = Duration::from_millis(16);

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InputRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl InputRect {
    fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && x < self.x + self.width && y >= self.y && y < self.y + self.height
    }
}

#[derive(Default)]
struct InputState {
    rects: Vec<InputRect>,
    drag_active: bool,
    forced_passthrough: Option<bool>,
    ignoring_mouse: bool,
}

#[derive(Default)]
struct DesktopState(Mutex<InputState>);

#[derive(Default)]
struct TrayIconState(Mutex<Option<Image<'static>>>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CursorPoint {
    x: f64,
    y: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CursorSample {
    cursor: CursorPoint,
    bounds: WindowBounds,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatRequest {
    base_url: String,
    model: String,
    temperature: f64,
    top_p: f64,
    max_tokens: Option<u32>,
    messages: Vec<ChatMessage>,
}

#[derive(Debug, Deserialize)]
struct ChatApiErrorBody {
    error: Option<ChatApiError>,
}

#[derive(Debug, Deserialize)]
struct ChatApiError {
    message: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ChatApiResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatResponseMessage,
}

#[derive(Debug, Deserialize)]
struct ChatResponseMessage {
    content: Option<String>,
}

#[tauri::command]
async fn send_chat_message(app: AppHandle, request: ChatRequest) -> Result<String, String> {
    if request.model.trim().is_empty() {
        return Err("模型名称不能为空".to_string());
    }
    if !request.temperature.is_finite() || !(0.0..=2.0).contains(&request.temperature) {
        return Err("创造性参数超出有效范围".to_string());
    }
    if !request.top_p.is_finite() || !(0.0..=1.0).contains(&request.top_p) {
        return Err("Top P 参数超出有效范围".to_string());
    }
    if request
        .max_tokens
        .is_some_and(|value| !(16..=8192).contains(&value))
    {
        return Err("最长回复需在 16 到 8192 tokens 之间".to_string());
    }

    let endpoint = format!(
        "{}/chat/completions",
        request.base_url.trim_end_matches('/')
    );
    let url = reqwest::Url::parse(&endpoint).map_err(|_| "API 地址无效".to_string())?;
    let is_local_http =
        url.scheme() == "http" && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1"));
    if url.scheme() != "https" && !is_local_http {
        return Err("远程 API 必须使用 HTTPS；本机服务可以使用 HTTP".to_string());
    }

    let api_key = load_api_key(&app)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|error| format!("无法创建网络请求：{error}"))?;
    let mut body = json!({
        "model": request.model,
        "temperature": request.temperature,
        "top_p": request.top_p,
        "messages": request.messages
    });
    if let Some(max_tokens) = request.max_tokens {
        body["max_tokens"] = json!(max_tokens);
    }

    let response = client
        .post(url)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("无法连接 API：{error}"))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("读取 API 响应失败：{error}"))?;
    if !status.is_success() {
        let detail = serde_json::from_str::<ChatApiErrorBody>(&body)
            .ok()
            .and_then(|value| value.error)
            .and_then(|error| error.message)
            .unwrap_or_else(|| format!("HTTP {}", status.as_u16()));
        return Err(format!("API 请求失败：{detail}"));
    }

    let parsed = serde_json::from_str::<ChatApiResponse>(&body)
        .map_err(|_| "API 返回格式不兼容 OpenAI Chat Completions".to_string())?;
    parsed
        .choices
        .into_iter()
        .next()
        .and_then(|choice| choice.message.content)
        .map(|content| content.trim().to_string())
        .filter(|content| !content.is_empty())
        .ok_or_else(|| "API 返回了空内容".to_string())
}

#[tauri::command]
fn save_chat_preset_template(
    app: AppHandle,
    model_id: String,
    contents: String,
) -> Result<String, String> {
    if contents.len() > 64 * 1024 {
        return Err("预设模板内容过大".to_string());
    }
    let safe_model_id = safe_model_id(&model_id)?;
    let path = app
        .path()
        .download_dir()
        .map_err(|error| format!("无法定位下载目录：{error}"))?
        .join(format!("{safe_model_id}.chat-preset.example.json"));
    fs::write(&path, contents.as_bytes()).map_err(|error| format!("保存预设模板失败：{error}"))?;
    Command::new("explorer.exe")
        .arg("/select,")
        .arg(&path)
        .spawn()
        .map_err(|error| format!("模板已保存，但无法打开资源管理器：{error}"))?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn save_api_key(app: AppHandle, api_key: String) -> Result<(), String> {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err("API Key 不能为空".to_string());
    }
    let encrypted = protect_secret(api_key.as_bytes())?;
    let path = api_key_path(&app)?;
    let parent = path
        .parent()
        .ok_or_else(|| "密钥保存路径无效".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("无法创建配置目录：{error}"))?;
    fs::write(path, encrypted).map_err(|error| format!("无法保存 API Key：{error}"))
}

#[tauri::command]
fn has_saved_api_key(app: AppHandle) -> Result<bool, String> {
    Ok(api_key_path(&app)?.is_file())
}

#[tauri::command]
fn delete_api_key(app: AppHandle) -> Result<(), String> {
    let path = api_key_path(&app)?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| format!("无法删除 API Key：{error}"))?;
    }
    Ok(())
}

#[tauri::command]
fn save_chat_memory(app: AppHandle, model_id: String, memory_json: String) -> Result<(), String> {
    if memory_json.len() > MAX_CHAT_MEMORY_BYTES {
        return Err("长期记忆数据过大".to_string());
    }
    let encrypted = protect_secret(memory_json.as_bytes())?;
    let path = chat_memory_path(&app, &model_id)?;
    let parent = path
        .parent()
        .ok_or_else(|| "记忆保存路径无效".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("无法创建配置目录：{error}"))?;
    fs::write(path, encrypted).map_err(|error| format!("无法保存长期记忆：{error}"))
}

#[tauri::command]
fn load_chat_memory(app: AppHandle, model_id: String) -> Result<Option<String>, String> {
    let path = chat_memory_path(&app, &model_id)?;
    if !path.is_file() {
        let legacy = legacy_chat_memory_path(&app)?;
        if model_id != "official.cyrene-live2d" || !legacy.is_file() {
            return Ok(None);
        }
        return read_chat_memory(&legacy).map(Some);
    }
    read_chat_memory(&path).map(Some)
}

#[tauri::command]
fn delete_chat_memory(app: AppHandle, model_id: String) -> Result<(), String> {
    let path = chat_memory_path(&app, &model_id)?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| format!("无法删除长期记忆：{error}"))?;
    }
    if model_id == "official.cyrene-live2d" {
        let legacy = legacy_chat_memory_path(&app)?;
        if legacy.exists() {
            fs::remove_file(legacy).map_err(|error| format!("无法删除旧版长期记忆：{error}"))?;
        }
    }
    Ok(())
}

#[tauri::command]
fn save_character_chat_settings(
    app: AppHandle,
    model_id: String,
    settings_json: String,
) -> Result<(), String> {
    if settings_json.len() > 64 * 1024 {
        return Err("角色聊天设置数据过大".to_string());
    }
    serde_json::from_str::<serde_json::Value>(&settings_json)
        .map_err(|_| "角色聊天设置不是有效 JSON".to_string())?;
    let path = character_chat_settings_path(&app, &model_id)?;
    let parent = path
        .parent()
        .ok_or_else(|| "角色聊天设置保存路径无效".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("无法创建角色聊天设置目录：{error}"))?;
    fs::write(path, settings_json.as_bytes())
        .map_err(|error| format!("无法保存角色聊天设置：{error}"))
}

#[tauri::command]
fn load_character_chat_settings(
    app: AppHandle,
    model_id: String,
) -> Result<Option<String>, String> {
    let path = character_chat_settings_path(&app, &model_id)?;
    if !path.is_file() {
        return Ok(None);
    }
    fs::read_to_string(path)
        .map(Some)
        .map_err(|error| format!("无法读取角色聊天设置：{error}"))
}

fn api_key_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join(API_KEY_FILE_NAME))
        .map_err(|error| format!("无法确定配置目录：{error}"))
}

fn chat_memory_path(app: &AppHandle, model_id: &str) -> Result<std::path::PathBuf, String> {
    let safe_model_id = safe_model_id(model_id)?;
    app.path()
        .app_data_dir()
        .map(|directory| {
            directory
                .join("chat")
                .join("memory")
                .join(format!("{safe_model_id}.dpapi"))
        })
        .map_err(|error| format!("无法确定配置目录：{error}"))
}

fn character_chat_settings_path(
    app: &AppHandle,
    model_id: &str,
) -> Result<std::path::PathBuf, String> {
    let safe_model_id = safe_model_id(model_id)?;
    app.path()
        .app_data_dir()
        .map(|directory| {
            directory
                .join("chat")
                .join("characters")
                .join(format!("{safe_model_id}.json"))
        })
        .map_err(|error| format!("无法确定配置目录：{error}"))
}

fn legacy_chat_memory_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join(LEGACY_CHAT_MEMORY_FILE_NAME))
        .map_err(|error| format!("无法确定配置目录：{error}"))
}

fn read_chat_memory(path: &std::path::Path) -> Result<String, String> {
    let encrypted = fs::read(path).map_err(|error| format!("无法读取长期记忆：{error}"))?;
    let decrypted = unprotect_secret(&encrypted)?;
    String::from_utf8(decrypted).map_err(|_| "保存的长期记忆数据无效".to_string())
}

fn safe_model_id(model_id: &str) -> Result<&str, String> {
    if model_id.is_empty()
        || model_id.len() > 128
        || !model_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'))
    {
        return Err("角色模型 ID 无效".to_string());
    }
    Ok(model_id)
}

fn load_api_key(app: &AppHandle) -> Result<String, String> {
    let encrypted = fs::read(api_key_path(app)?).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            "尚未保存 API Key".to_string()
        } else {
            format!("无法读取 API Key：{error}")
        }
    })?;
    let decrypted = unprotect_secret(&encrypted)?;
    String::from_utf8(decrypted).map_err(|_| "保存的 API Key 数据无效".to_string())
}

fn protect_secret(secret: &[u8]) -> Result<Vec<u8>, String> {
    let data_len = u32::try_from(secret.len()).map_err(|_| "待加密数据过长".to_string())?;
    let input = CRYPT_INTEGER_BLOB {
        cbData: data_len,
        pbData: secret.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    let succeeded = unsafe {
        CryptProtectData(
            &input,
            ptr::null(),
            ptr::null(),
            ptr::null(),
            ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if succeeded == 0 {
        return Err(format!(
            "Windows 无法加密本机数据：{}",
            std::io::Error::last_os_error()
        ));
    }
    let encrypted =
        unsafe { slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec();
    unsafe { LocalFree(output.pbData.cast()) };
    Ok(encrypted)
}

fn unprotect_secret(encrypted: &[u8]) -> Result<Vec<u8>, String> {
    let data_len = u32::try_from(encrypted.len()).map_err(|_| "加密数据过长".to_string())?;
    let input = CRYPT_INTEGER_BLOB {
        cbData: data_len,
        pbData: encrypted.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    let succeeded = unsafe {
        CryptUnprotectData(
            &input,
            ptr::null_mut(),
            ptr::null(),
            ptr::null(),
            ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if succeeded == 0 {
        return Err(format!(
            "Windows 无法解密本机数据：{}",
            std::io::Error::last_os_error()
        ));
    }
    let secret = unsafe { slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec();
    unsafe { LocalFree(output.pbData.cast()) };
    Ok(secret)
}

#[tauri::command]
fn set_window_shape(state: State<'_, DesktopState>, rects: Vec<InputRect>) -> Result<(), String> {
    let mut input = state.0.lock().map_err(|error| error.to_string())?;
    input.rects = rects
        .into_iter()
        .filter(|rect| {
            rect.x.is_finite()
                && rect.y.is_finite()
                && rect.width.is_finite()
                && rect.height.is_finite()
                && rect.width > 0.0
                && rect.height > 0.0
        })
        .collect();
    input.forced_passthrough = None;
    Ok(())
}

#[tauri::command]
fn set_drag_active(state: State<'_, DesktopState>, drag_active: bool) -> Result<(), String> {
    state
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .drag_active = drag_active;
    Ok(())
}

#[tauri::command]
fn set_mouse_passthrough(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    should_pass_through: bool,
) -> Result<(), String> {
    window
        .set_ignore_cursor_events(should_pass_through)
        .map_err(|error| error.to_string())?;
    let mut input = state.0.lock().map_err(|error| error.to_string())?;
    input.forced_passthrough = Some(should_pass_through);
    input.ignoring_mouse = should_pass_through;
    Ok(())
}

#[tauri::command]
fn set_tray_icon(
    app: AppHandle,
    state: State<'_, TrayIconState>,
    image_bytes: Vec<u8>,
) -> Result<(), String> {
    let image: Image<'static> =
        Image::from_bytes(&image_bytes).map_err(|error| error.to_string())?;
    *state.0.lock().map_err(|error| error.to_string())? = Some(image.clone());
    let pet_is_visible = app
        .get_webview_window(PET_WINDOW_LABEL)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false);
    let tray = app
        .tray_by_id("main")
        .ok_or_else(|| "tray icon is not ready".to_string())?;
    tray.set_icon(Some(if pet_is_visible {
        image
    } else {
        grayscale_image(&image)
    }))
    .map_err(|error| error.to_string())
}

fn grayscale_image(source: &Image<'_>) -> Image<'static> {
    let mut rgba = source.rgba().to_vec();
    for pixel in rgba.chunks_exact_mut(4) {
        let luminance = ((u16::from(pixel[0]) * 77
            + u16::from(pixel[1]) * 150
            + u16::from(pixel[2]) * 29)
            >> 8) as u8;
        pixel[0] = luminance;
        pixel[1] = luminance;
        pixel[2] = luminance;
    }
    Image::new_owned(rgba, source.width(), source.height())
}

fn update_tray_icon_for_visibility(app: &AppHandle, visible: bool) {
    let colored_icon = app
        .state::<TrayIconState>()
        .0
        .lock()
        .ok()
        .and_then(|icon| icon.clone())
        .or_else(|| {
            app.default_window_icon()
                .map(|icon| icon.clone().to_owned())
        });
    let Some(colored_icon) = colored_icon else {
        return;
    };
    let icon = if visible {
        colored_icon
    } else {
        grayscale_image(&colored_icon)
    };
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_icon(Some(icon));
    }
}

fn toggle_pet_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window(PET_WINDOW_LABEL) else {
        return;
    };

    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        update_tray_icon_for_visibility(app, false);
    } else {
        let _ = window.show();
        let _ = window.set_focus();
        update_tray_icon_for_visibility(app, true);
    }
}

fn open_settings_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(SETTINGS_WINDOW_LABEL) {
        apply_settings_dwm_colors(&window);
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        return;
    }

    let builder = WebviewWindowBuilder::new(
        app,
        SETTINGS_WINDOW_LABEL,
        WebviewUrl::App("settings.html".into()),
    )
    .title("控制中心")
    .inner_size(1100.0, 760.0)
    .min_inner_size(820.0, 600.0)
    .resizable(true)
    .decorations(true)
    .shadow(true)
    .center();
    let window_icon: Option<Image<'static>> = Image::from_bytes(SETTINGS_ICON_BYTES).ok();
    let result = match window_icon {
        Some(icon) => builder.icon(icon).and_then(|builder| builder.build()),
        None => match app.default_window_icon() {
            Some(icon) => builder
                .icon(icon.clone())
                .and_then(|builder| builder.build()),
            None => builder.build(),
        },
    };
    match result {
        Ok(window) => apply_settings_dwm_colors(&window),
        Err(error) => eprintln!("failed to open settings window: {error}"),
    }
}

fn apply_settings_dwm_colors(window: &WebviewWindow) {
    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    // DWM uses COLORREF (0x00BBGGRR), not the usual RGB byte order.
    let border_color: u32 = 0x006D_7177;
    let caption_color: u32 = 0x002D_2E30;
    let text_color: u32 = 0x00EC_F1F4;
    let corner_preference = DWMWCP_ROUND;
    unsafe {
        let _ = DwmSetWindowAttribute(
            hwnd.0,
            DWMWA_BORDER_COLOR as u32,
            (&border_color as *const u32).cast(),
            std::mem::size_of_val(&border_color) as u32,
        );
        let _ = DwmSetWindowAttribute(
            hwnd.0,
            DWMWA_CAPTION_COLOR as u32,
            (&caption_color as *const u32).cast(),
            std::mem::size_of_val(&caption_color) as u32,
        );
        let _ = DwmSetWindowAttribute(
            hwnd.0,
            DWMWA_TEXT_COLOR as u32,
            (&text_color as *const u32).cast(),
            std::mem::size_of_val(&text_color) as u32,
        );
        let _ = DwmSetWindowAttribute(
            hwnd.0,
            DWMWA_WINDOW_CORNER_PREFERENCE as u32,
            (&corner_preference as *const i32).cast(),
            std::mem::size_of_val(&corner_preference) as u32,
        );
    }
}

fn configure_pet_window(window: &WebviewWindow) -> tauri::Result<()> {
    if let Some(monitor) = window.primary_monitor()? {
        let position = monitor.position();
        let size = monitor.size();
        window.set_position(PhysicalPosition::new(position.x, position.y))?;
        window.set_size(PhysicalSize::new(size.width, size.height))?;
    }
    window.set_always_on_top(true)?;
    window.set_ignore_cursor_events(true)?;
    Ok(())
}

fn start_cursor_sampling(app: AppHandle) {
    thread::spawn(move || {
        loop {
            let Some(window) = app.get_webview_window(PET_WINDOW_LABEL) else {
                break;
            };

            if !window.is_visible().unwrap_or(false) {
                thread::sleep(Duration::from_millis(100));
                continue;
            }

            let (Ok(cursor), Ok(position), Ok(size), Ok(scale_factor)) = (
                app.cursor_position(),
                window.outer_position(),
                window.outer_size(),
                window.scale_factor(),
            ) else {
                thread::sleep(CURSOR_SAMPLE_INTERVAL);
                continue;
            };

            let local_x = (cursor.x - f64::from(position.x)) / scale_factor;
            let local_y = (cursor.y - f64::from(position.y)) / scale_factor;
            let logical_width = f64::from(size.width) / scale_factor;
            let logical_height = f64::from(size.height) / scale_factor;

            {
                let state = app.state::<DesktopState>();
                let Ok(mut input) = state.0.lock() else {
                    thread::sleep(CURSOR_SAMPLE_INTERVAL);
                    continue;
                };
                let should_ignore = input.forced_passthrough.unwrap_or_else(|| {
                    !input.drag_active
                        && !input
                            .rects
                            .iter()
                            .any(|rect| rect.contains(local_x, local_y))
                });
                if input.ignoring_mouse != should_ignore {
                    input.ignoring_mouse = should_ignore;
                    let _ = window.set_ignore_cursor_events(should_ignore);
                }
            }
            let _ = app.emit_to(
                PET_WINDOW_LABEL,
                "cyrene:cursor-sample",
                CursorSample {
                    cursor: CursorPoint {
                        x: local_x,
                        y: local_y,
                    },
                    bounds: WindowBounds {
                        x: 0.0,
                        y: 0.0,
                        width: logical_width,
                        height: logical_height,
                    },
                },
            );

            thread::sleep(CURSOR_SAMPLE_INTERVAL);
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(DesktopState::default())
        .manage(TrayIconState::default())
        .invoke_handler(tauri::generate_handler![
            set_window_shape,
            set_drag_active,
            set_mouse_passthrough,
            set_tray_icon,
            send_chat_message,
            save_chat_preset_template,
            save_api_key,
            has_saved_api_key,
            delete_api_key,
            save_chat_memory,
            load_chat_memory,
            delete_chat_memory,
            save_character_chat_settings,
            load_character_chat_settings
        ])
        .setup(|app| {
            let toggle = MenuItem::with_id(app, "toggle", "显示/隐藏桌宠", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "打开设置", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出 Cyrene", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&toggle, &settings, &quit])?;

            let mut tray = TrayIconBuilder::with_id("main")
                .tooltip("Cyrene 桌宠")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "toggle" => toggle_pet_window(app),
                    "settings" => open_settings_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
                *app.state::<TrayIconState>().0.lock().unwrap() = Some(icon.clone().to_owned());
            }
            tray.build(app)?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build Cyrene desktop host")
        .run(|app, event| {
            if let tauri::RunEvent::Ready = event {
                if let Some(window) = app.get_webview_window(PET_WINDOW_LABEL) {
                    if let Err(error) = configure_pet_window(&window) {
                        eprintln!("failed to configure pet window: {error}");
                    }
                }
                start_cursor_sampling(app.clone());
            }
        });
}

#[cfg(test)]
mod tests {
    use super::{InputRect, grayscale_image, protect_secret, safe_model_id, unprotect_secret};
    use tauri::image::Image;

    #[test]
    fn input_rect_contains_left_and_top_edges_only() {
        let rect = InputRect {
            x: 10.0,
            y: 20.0,
            width: 30.0,
            height: 40.0,
        };

        assert!(rect.contains(10.0, 20.0));
        assert!(rect.contains(39.999, 59.999));
        assert!(!rect.contains(40.0, 20.0));
        assert!(!rect.contains(10.0, 60.0));
    }

    #[test]
    fn grayscale_icon_preserves_alpha_and_equalizes_rgb_channels() {
        let source = Image::new_owned(vec![200, 100, 50, 123], 1, 1);
        let grayscale = grayscale_image(&source);

        assert_eq!(grayscale.rgba(), &[124, 124, 124, 123]);
        assert_eq!(grayscale.width(), 1);
        assert_eq!(grayscale.height(), 1);
    }

    #[test]
    fn dpapi_secret_round_trip_is_bound_to_current_windows_user() {
        let encrypted = protect_secret(b"test-secret").expect("DPAPI encryption should succeed");
        assert_ne!(encrypted, b"test-secret");
        assert_eq!(
            unprotect_secret(&encrypted).expect("DPAPI decryption should succeed"),
            b"test-secret"
        );
    }

    #[test]
    fn model_id_is_safe_for_character_scoped_file_names() {
        assert_eq!(
            safe_model_id("official.cyrene-live2d"),
            Ok("official.cyrene-live2d")
        );
        assert!(safe_model_id("../escape").is_err());
        assert!(safe_model_id("角色").is_err());
        assert!(safe_model_id("").is_err());
    }
}
