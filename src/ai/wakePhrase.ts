/** Match an explicit activation at the start of a confirmed Cartesia turn. */
export function wakeCommand(text: string): string | undefined {
  const activation = /^\s*hey[\s,]+agent\b[\s,.:!?—–-]*/i.exec(text);
  return activation ? text.slice(activation[0].length).trim() : undefined;
}
