use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TicketRenderData {
    pub event_name: String,
    pub venue_name: String,
    pub city: String,
    pub state: String,
    pub event_date_long: String,
    pub event_time: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub section: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub row: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seat: Option<String>,
    pub admission_type: String,
    pub price: String,
    pub event_code: String,
    pub order_id: String,
    pub qr_payload: String,
    pub print_timestamp: String,
}

fn rc(row: u32, col: u32) -> String {
    format!("<RC{},{}>", row, col)
}

fn font(size: u8) -> String {
    format!("<F{}>", size)
}

fn qr(size: u8, payload: &str) -> String {
    format!("<QR{}>{{{}}}", size, payload)
}

fn qrv(version: u8) -> String {
    format!("<QRV{}>", version)
}

fn to_ascii(input: &str) -> String {
    let s = diacritics::remove_diacritics(input);
    s.replace('\u{2014}', "-")
        .replace('\u{2013}', "-")
        .replace('\u{201C}', "\"")
        .replace('\u{201D}', "\"")
        .replace('\u{2018}', "'")
        .replace('\u{2019}', "'")
        .replace('\u{2022}', "*")
        .replace('\u{00B7}', "*")
}

fn sanitize_text(input: &str) -> String {
    input.replace(['<', '>'], "")
}

fn transform(input: &str) -> String {
    to_ascii(&sanitize_text(input))
}

pub fn render_ticket(data: &TicketRenderData) -> Result<String, String> {
    if data.qr_payload.contains('<') || data.qr_payload.contains('>') {
        return Err("qr_payload contains '<' or '>' which would break the FGL parser".to_string());
    }

    let has_seat_info = data.seat.is_some() || data.row.is_some();
    let mut parts = Vec::new();

    parts.push(format!("{}{}{}", rc(10, 20), font(6), transform(&data.event_name)));
    parts.push(format!("{}{}{} - {}, {}", rc(110, 20), font(2), transform(&data.venue_name), transform(&data.city), transform(&data.state)));
    parts.push(format!("{}{}{}   {}", rc(150, 20), font(3), transform(&data.event_date_long), transform(&data.event_time)));

    if has_seat_info {
        let section = data.section.as_deref().unwrap_or("");
        let row = data.row.as_deref().unwrap_or("");
        let seat = data.seat.as_deref().unwrap_or("");
        parts.push(format!("{}{}SEC {}  ROW {}  SEAT {}", rc(210, 20), font(3), transform(section), transform(row), transform(seat)));
        parts.push(format!("{}{}{}", rc(260, 20), font(2), transform(&data.admission_type)));
    } else {
        parts.push(format!("{}{}{}", rc(210, 20), font(3), transform(&data.admission_type)));
    }

    parts.push(format!("{}{}{}    CODE: {}", rc(510, 20), font(2), transform(&data.price), transform(&data.event_code)));
    parts.push(qrv(7));
    parts.push(format!("{}{}", rc(150, 1000), qr(8, &data.qr_payload)));
    parts.push(format!("{}{}Order {}  *  Printed {}", rc(700, 20), font(1), transform(&data.order_id), transform(&data.print_timestamp)));
    parts.push("<p>".to_string());

    Ok(parts.join(""))
}
