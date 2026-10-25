/** Formata o telefone brasileiro preservando o cursor junto ao dígito editado. */
export function maskPhone(input: HTMLInputElement): string {
  const beforeCaret = input.value.slice(0, input.selectionStart ?? input.value.length).replace(/\D/g, '').length;
  const digits = input.value.replace(/\D/g, '').slice(0, 11);
  const split = digits.length > 10 ? 7 : 6;
  let value = digits ? `(${digits.slice(0, 2)}` : '';
  if (digits.length >= 2) value += ')';
  if (digits.length > 2) value += ` ${digits.slice(2, split)}`;
  if (digits.length > split) value += `-${digits.slice(split)}`;
  const positions = Array.from(value.matchAll(/\d/g), match => match.index + 1);
  const position = positions[Math.min(beforeCaret, positions.length) - 1] ?? 0;
  input.value = value;
  input.setSelectionRange(position, position);
  return value;
}

/** Interpreta dígitos como centavos; limita a oito dígitos inteiros e duas casas decimais. */
export function maskMoney(input: HTMLInputElement): string {
  const afterCaret = input.value.slice(input.selectionStart ?? input.value.length).replace(/\D/g, '').length;
  const digits = input.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 10);
  const padded = digits.padStart(3, '0');
  const value = digits ? padded.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + padded.slice(-2) : '';
  input.value = value;
  let position = value.length;
  let remaining = afterCaret;
  while (position > 0 && remaining > 0) {
    position--;
    if (/\d/.test(value[position])) remaining--;
  }
  input.setSelectionRange(position, position);
  return value;
}
