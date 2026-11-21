// A fast CSV reader with csv-reader 1.0.0's exact broken-row policy.
//
// Reads one input {text, header} and returns {columns, rows, errors}:
// the header (or null), every other record as an array of strings at the
// first record's width, and one error record for every broken thing met.
// The policy, implemented here from scratch:
//
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is
//     no record;
//   - outside a quoted field a CR not followed by LF is dropped
//     (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not
//     doubled, "" inside it one quote, and each CRLF or lone CR inside it
//     is read as LF; what follows its closing quote, up to the next comma
//     or line break, is appended as it stands (quote_junk, when the field
//     ends); a quote that never closes is a literal character, and the
//     text after it is read again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields
//     stay strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows
//     holds the records after it (every record when header is false), each
//     padded with "" (short_row, with fields: its field count) or cut
//     (long_row, with extra: the cut fields) to the first record's width;
//   - each error is {code, line, row}: line the 1-based line its record
//     starts on (every LF, CRLF and lone CR inside a quoted field
//     counted), row its record's index in rows (null for the header), in
//     the order met, a field's quote_junk when the field ends and a
//     record's short_row or long_row when the record ends.
//
// Speed comes from letting the engine do the scanning: fields are cut
// with indexOf + slice instead of one character at a time, so a plain
// field costs a couple of short native scans and one slice. Only the
// rare paths (a stray CR, a line break inside quotes) fall back to a
// short character scan over just the affected span.

/** How a field ended: at a comma (the record goes on), at a line break or at the end of the text (the record ends). */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const len = text.length;
  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (len > 0 && text.charCodeAt(0) === 0xFEFF) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  function pushError(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads unquoted characters onto `value` up to the next comma or line break: a CR not followed by LF is dropped
  // (stray_cr). Returns [value, ended, added], where `added` counts the characters kept.
  function readUnquoted(value) {
    let added = 0;
    for (;;) {
      let iComma = text.indexOf(',', pos);
      let iLf = text.indexOf('\n', pos);
      if (iComma === -1) iComma = Infinity;
      if (iLf === -1) iLf = Infinity;
      const end = iComma < iLf ? iComma : iLf;
      if (end === Infinity) {
        // No comma or LF left: the rest of the text is one field, apart from stray CRs in it.
        let s = pos;
        for (;;) {
          const cr = text.indexOf('\r', s);
          if (cr === -1) {
            value += text.slice(s);
            added += len - s;
            pos = len;
            return [value, END, added];
          }
          pushError('stray_cr');
          value += text.slice(s, cr);
          added += cr - s;
          s = cr + 1;
        }
      }
      const seg = text.slice(pos, end);
      const cr = seg.indexOf('\r');
      if (cr === -1) {
        value += seg;
        added += seg.length;
        if (end === iComma) {
          pos = end + 1;
          return [value, COMMA, added];
        }
        pos = end + 1;
        line += 1;
        return [value, LINE_BREAK, added];
      }
      if (cr === seg.length - 1 && end === iLf) {
        // The CR sits right before the LF: one CRLF line break, not a stray CR.
        value += seg.slice(0, cr);
        added += cr;
        pos = end + 1;
        line += 1;
        return [value, LINE_BREAK, added];
      }
      // A lone CR inside the field: drop it, record it, and keep reading from just past it.
      pushError('stray_cr');
      value += seg.slice(0, cr);
      added += cr;
      pos += cr + 1;
    }
  }

  // Reads a quoted field whose opening quote is at pos. Returns [value, ended, added].
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    pos += 1;
    for (;;) {
      const q = text.indexOf('"', pos);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text after it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        pushError('unterminated_quote');
        return readUnquoted('"');
      }
      const seg = text.slice(pos, q);
      if (seg.indexOf('\n') === -1 && seg.indexOf('\r') === -1) {
        value += seg;
      } else {
        // Line breaks inside quotes: each LF, CRLF and lone CR is one LF in the value and one line.
        // Copy the runs between breaks in whole slices instead of one character at a time.
        let runStart = 0;
        for (let i = 0; i < seg.length; i++) {
          const c = seg.charCodeAt(i);
          if (c === 13) {
            if (i > runStart) value += seg.slice(runStart, i);
            value += '\n';
            line += 1;
            if (i + 1 < seg.length && seg.charCodeAt(i + 1) === 10) i += 1;
            runStart = i + 1;
          } else if (c === 10) {
            if (i > runStart) value += seg.slice(runStart, i);
            value += '\n';
            line += 1;
            runStart = i + 1;
          }
        }
        if (runStart < seg.length) value += seg.slice(runStart);
      }
      if (q + 1 < len && text.charCodeAt(q + 1) === 34) {
        // A doubled quote inside the field: one literal quote, and the field goes on.
        value += '"';
        pos = q + 2;
        continue;
      }
      pos = q + 1;
      if (pos >= len) return [value, END, 0];
      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos += 1;
        return [value, COMMA, 0];
      }
      if (c === 10) {
        pos += 1;
        line += 1;
        return [value, LINE_BREAK, 0];
      }
      if (c === 13 && pos + 1 < len && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        return [value, LINE_BREAK, 0];
      }
      // What follows the closing quote is appended as it stands, up to the next comma or line break.
      const junk = readUnquoted(value);
      if (junk[2] > 0) pushError('quote_junk');
      return junk;
    }
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && pos + 1 < len && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let ended;
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      const field = quoted ? readQuoted() : readUnquoted('');
      fields.push(field[0]);
      ended = field[1];
    } while (ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
