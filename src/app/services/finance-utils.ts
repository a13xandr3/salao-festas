/** Aceita valores decimais e o formato brasileiro produzido pela máscara monetária. */
export const moneyPattern = /^(?![0.,]+$)(?:\d{1,8}(?:[.,]\d{1,2})?|\d{1,2}(?:\.\d{3}){1,2},\d{2})$/;

/** Converte a exibição em string decimal, sem arredondamento de ponto flutuante. */
export function moneyValue(value: string): string {
  return value.includes(',') ? value.replace(/\./g, '').replace(',', '.') : value;
}

/** Exibe apenas erros que as RPCs definem deliberadamente como mensagens públicas. */
export function financeError(error: unknown): string {
  const details = error as { code?: string; message?: string } | null;
  if (['PT400', 'PT404', 'PT409'].includes(details?.code ?? '') && typeof details?.message === 'string' && details.message) return details.message;
  return 'Não foi possível concluir a operação financeira. Atualize e tente novamente.';
}

export function expenseError(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  if (code === 'PGRST202') return 'O relatório de despesas ainda não está disponível no banco. Aplique a migração 202610230005_expense_report.sql no Supabase.';
  if (code === 'PT403' || code === '42501') return 'Sem permissão para consultar despesas. Entre novamente com uma conta administradora e confirme o segundo fator.';
  return financeError(error);
}

/** Preserva a chave de reenvio até mudar o conteúdo ou o servidor confirmar sucesso. */
export class RequestKey {
  private pending?: { fingerprint: string; key: string };

  forPayload(payload: object): string {
    const fingerprint = JSON.stringify(payload);
    if (this.pending?.fingerprint !== fingerprint) this.pending = { fingerprint, key: crypto.randomUUID() };
    return this.pending.key;
  }

  clear(): void { this.pending = undefined; }
}
