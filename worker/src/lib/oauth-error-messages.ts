// Mapping de (status, reason) → mensagem amigável em PT-BR.
// Worker grava o reason na URL de redirect; App lê e mostra toast.
// Cópia em app/lib/google-ads/oauth-error-messages.ts (manter sync — tech debt §13 do spec).

export type OAuthStatus = 'connected' | 'session_expired' | 'oauth_error' | 'sync_started';

export type OAuthReason =
  | 'state_invalid'
  | 'state_missing'
  | 'state_mismatch'
  | 'code_exchange_failed'
  | 'no_accounts'
  | 'db_error'
  | 'user_cancelled';

export function getOAuthMessage(status: OAuthStatus, reason?: string): string | null {
  if (status === 'connected') return 'Conta conectada com sucesso.';
  if (status === 'session_expired') return 'Sessão de seleção expirou. Reconecte.';
  if (status === 'sync_started') return 'Sincronização iniciada...';
  if (status === 'oauth_error') {
    switch (reason as OAuthReason) {
      case 'state_invalid':
      case 'state_missing':
      case 'state_mismatch':
        return 'Validação de segurança falhou. Tente novamente.';
      case 'code_exchange_failed':
        return 'Não foi possível concluir a autenticação Google. Tente novamente.';
      case 'no_accounts':
        return 'Sua conta Google não tem nenhuma conta Google Ads acessível.';
      case 'db_error':
        return 'Erro interno. Tente novamente em instantes.';
      case 'user_cancelled':
        return null; // sem toast
      default:
        return 'Erro inesperado durante a conexão. Tente novamente.';
    }
  }
  return null;
}
