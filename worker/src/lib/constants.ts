// Janela máxima do Google Ads pra aceitar conversion adjustments (refund/chargeback).
// Eventos de adjustment fora dessa janela são rejeitados pelo Data Manager API,
// então logamos warn agora e Fase 3 vai criar conversion_uploads com status='skipped_window_expired'.
//
// Janela de 55d inclusiva (Google Ads aceita até 55d exato; warn emitido apenas a partir de >55d).
export const ORIGINAL_CONVERSION_WINDOW_DAYS = 55;
