export type TextLineRange = Readonly<{
  endLine: number;
  text: string;
}>;

/**
 * Selects physical UTF-8 text lines without normalizing their line endings.
 * An omitted end line intentionally means "through EOF" and retains a final
 * line ending; an explicit end line stops before that line's terminator.
 */
export function selectTextLineRange(
  content: string,
  startLine: number,
  endLine: number | undefined,
): TextLineRange | undefined {
  const lines = textLines(content);
  if (startLine > lines.length) return undefined;
  const resolvedEndLine = endLine === undefined ? lines.length : Math.min(endLine, lines.length);
  if (resolvedEndLine < startLine) return undefined;
  const start = lines[startLine - 1];
  const end = lines[resolvedEndLine - 1];
  if (start === undefined || end === undefined) return undefined;
  return {
    endLine: resolvedEndLine,
    text:
      endLine === undefined
        ? content.slice(start.start)
        : content.slice(start.start, end.contentEnd),
  };
}

/** Returns physical line text without its line ending for match-oriented tools. */
export function textLinesWithoutEndings(content: string): readonly string[] {
  return textLines(content).map((line) => content.slice(line.start, line.contentEnd));
}

type TextLine = Readonly<{
  start: number;
  contentEnd: number;
}>;

function textLines(content: string): readonly TextLine[] {
  if (content.length === 0) return [{ start: 0, contentEnd: 0 }];
  const lines: TextLine[] = [];
  let start = 0;
  while (start < content.length) {
    const lf = content.indexOf('\n', start);
    const cr = content.indexOf('\r', start);
    const newline = lf < 0 ? cr : cr < 0 ? lf : Math.min(lf, cr);
    if (newline < 0) {
      lines.push({ start, contentEnd: content.length });
      break;
    }
    lines.push({ start, contentEnd: newline });
    start = content[newline] === '\r' && content[newline + 1] === '\n' ? newline + 2 : newline + 1;
  }
  return lines;
}
