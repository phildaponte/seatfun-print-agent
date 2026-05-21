export interface TicketRenderData {
  event_name: string;
  venue_name: string;
  city: string;
  state: string;
  event_date_long: string;
  event_time: string;
  section?: string;
  row?: string;
  seat?: string;
  admission_type: string;
  price: string;
  event_code: string;
  order_id: string;
  qr_payload: string;
  print_timestamp: string;
}

export type FontSize = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
