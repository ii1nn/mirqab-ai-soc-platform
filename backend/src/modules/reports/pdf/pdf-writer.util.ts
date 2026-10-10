import PDFDocument from 'pdfkit';
import { BRAND } from './mirqab-branding';

/**
 * Thin convenience wrapper over pdfkit's low-level, imperative drawing API —
 * shared by the Case-Based Digital Forensics Report and the Weekly SOC
 * Report so both get consistent typography/spacing without duplicating
 * layout code. Not a general-purpose PDF library wrapper — just the small
 * set of primitives these two reports actually need.
 *
 * Everything below `finish()` in this class up to here is the ORIGINAL,
 * unmodified primitive set — CaseReportService uses only these, and their
 * behavior is untouched. Every method after that point is a new, additive
 * "premium" primitive built for the Weekly SOC Report redesign; none of
 * them are called by CaseReportService, and none of them alter the methods
 * above.
 */
export class PdfWriter {
  readonly doc: PDFKit.PDFDocument;
  private readonly chunks: Buffer[] = [];
  /** Only set once `enablePremiumChrome()` is called (weekly report only) —
   * CaseReportService never calls it, so its pageAdded behavior is
   * unaffected and it keeps using the plain `pageNumbers()` footer. */
  private premiumChrome: { logo: Buffer; runningTitle: string } | null = null;
  /** pdfkit's built-in image cache only activates when `.image()` is given a
   * *string* file path (see ImagesMixin.image() in pdfkit's source) —
   * passing the same Buffer on every call bypasses it entirely and fully
   * re-decodes the PNG (zlib inflate of the raw pixel/alpha data) on every
   * single embed. `doc.openImage()` (present at runtime; not declared in
   * @types/pdfkit, hence the casts below) returns an already-decoded image
   * handle that `.image()` reuses directly when passed back in — it
   * duck-types on `.width`/`.height` rather than requiring a string. Cached
   * here per buffer so the logo is decoded once per document instead of
   * once per embed (measured: ~15s+ per report with 8 re-decodes down to
   * a single decode). */
  private readonly openedImages = new Map<Buffer, unknown>();

  constructor() {
    this.doc = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true });
    this.doc.on('data', (chunk: Buffer) => this.chunks.push(chunk));
  }

  async finish(): Promise<Buffer> {
    this.doc.end();
    await new Promise<void>((resolve) => this.doc.on('end', resolve));
    return Buffer.concat(this.chunks);
  }

  /** See `openedImages`' doc comment — decodes `buffer` via pdfkit's
   * `openImage()` at most once, and returns the cached handle (typed as
   * `Buffer` to satisfy `.image()`'s declared signature; pdfkit accepts it
   * at runtime because it duck-types on `.width`/`.height`). */
  private openImageOnce(buffer: Buffer): Buffer {
    let handle = this.openedImages.get(buffer);
    if (!handle) {
      handle = (this.doc as unknown as { openImage(src: Buffer): unknown }).openImage(buffer);
      this.openedImages.set(buffer, handle);
    }
    return handle as unknown as Buffer;
  }

  private ensureSpace(height: number): void {
    const bottom = this.doc.page.height - this.doc.page.margins.bottom;
    if (this.doc.y + height > bottom) {
      this.doc.addPage();
    }
  }

  coverTitle(title: string, subtitle: string): this {
    this.doc
      .fontSize(24)
      .fillColor('#0F172A')
      .text(title, { align: 'center' })
      .moveDown(0.3)
      .fontSize(13)
      .fillColor('#475569')
      .text(subtitle, { align: 'center' })
      .moveDown(1.5);
    return this;
  }

  metaLine(label: string, value: string): this {
    this.ensureSpace(18);
    this.doc
      .fontSize(10)
      .fillColor('#64748B')
      .text(`${label}: `, { continued: true })
      .fillColor('#0F172A')
      .text(value);
    return this;
  }

  divider(): this {
    this.ensureSpace(16);
    this.doc.moveDown(0.4);
    const y = this.doc.y;
    this.doc
      .strokeColor('#E2E8F0')
      .lineWidth(1)
      .moveTo(this.doc.page.margins.left, y)
      .lineTo(this.doc.page.width - this.doc.page.margins.right, y)
      .stroke();
    this.doc.moveDown(0.6);
    return this;
  }

  heading(text: string): this {
    this.ensureSpace(34);
    this.doc.moveDown(0.5).fontSize(16).fillColor('#0F172A').text(text);
    this.doc.moveDown(0.3);
    return this;
  }

  subheading(text: string): this {
    this.ensureSpace(24);
    this.doc.fontSize(12).fillColor('#1E293B').text(text);
    this.doc.moveDown(0.2);
    return this;
  }

  paragraph(text: string): this {
    this.ensureSpace(20);
    this.doc.fontSize(10).fillColor('#334155').text(text, { align: 'left' });
    this.doc.moveDown(0.4);
    return this;
  }

  /** No-data placeholder — requirement #4/#35: never fabricate a number/finding, say so plainly. */
  emptyState(text: string): this {
    this.ensureSpace(18);
    this.doc.font('Helvetica-Oblique').fontSize(10).fillColor('#94A3B8').text(text);
    this.doc.font('Helvetica').moveDown(0.4);
    return this;
  }

  keyValueTable(rows: Array<[string, string]>): this {
    for (const [key, value] of rows) {
      this.ensureSpace(16);
      const startY = this.doc.y;
      this.doc.fontSize(9).fillColor('#64748B').text(key, 50, startY, { width: 150 });
      this.doc
        .fontSize(9)
        .fillColor('#0F172A')
        .text(value || '—', 210, startY, { width: 335 });
      this.doc.moveDown(0.3);
    }
    this.doc.moveDown(0.3);
    return this;
  }

  bulletList(items: string[]): this {
    for (const item of items) {
      this.ensureSpace(16);
      this.doc.fontSize(9.5).fillColor('#334155').text(`• ${item}`, { indent: 10 });
    }
    this.doc.moveDown(0.3);
    return this;
  }

  pageNumbers(): void {
    const range = this.doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      this.doc.switchToPage(i);
      this.doc
        .fontSize(8)
        .fillColor('#94A3B8')
        .text(`Page ${i + 1} of ${range.count}`, 0, this.doc.page.height - 40, {
          align: 'center',
        });
    }
  }

  // ===========================================================================
  // Premium primitives — additive, Weekly SOC Report only (opt-in via
  // enablePremiumChrome). CaseReportService never calls anything below this
  // line, so its output is byte-for-byte unaffected by this section.
  // ===========================================================================

  private get contentLeft(): number {
    return this.doc.page.margins.left;
  }
  private get contentWidth(): number {
    return this.doc.page.width - this.doc.page.margins.left - this.doc.page.margins.right;
  }

  /** Opts in to the slim repeating header drawn automatically on every page
   * *after* the first (page 1 gets the larger `heroHeader()` instead, drawn
   * explicitly). Must be called once, before any content is written. */
  enablePremiumChrome(logo: Buffer, runningTitle: string): this {
    this.premiumChrome = { logo, runningTitle };
    this.doc.on('pageAdded', () => this.drawRunningHeader());
    return this;
  }

  private drawRunningHeader(): void {
    if (!this.premiumChrome) return;
    const { logo, runningTitle } = this.premiumChrome;
    const top = this.doc.page.margins.top - 26;
    this.doc.image(this.openImageOnce(logo), this.contentLeft, top, { width: 18, height: 18 });
    this.doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(BRAND.navy)
      .text(runningTitle, this.contentLeft + 24, top + 3, { lineBreak: false });
    this.doc
      .strokeColor(BRAND.purple)
      .lineWidth(1.2)
      .moveTo(this.contentLeft, top + 22)
      .lineTo(this.doc.page.width - this.doc.page.margins.right, top + 22)
      .stroke();
    this.doc.y = this.doc.page.margins.top;
  }

  /** Page-1-only hero header: logo + brand at top-left, SOC tagline at
   * top-right, thin purple accent line, then the large centered report
   * title and subtitle. Genuinely shared between the Weekly SOC Report and
   * the Case Report — `title`/`subtitle` are both rendered verbatim (no
   * hardcoded report-specific text here), so each caller supplies its own
   * exact wording. Weekly's own call site passes the identical text this
   * method used to hardcode, so its rendered output is unchanged. */
  heroHeader(logo: Buffer, title: string, subtitle: string): this {
    const startY = this.doc.y;
    this.doc.image(this.openImageOnce(logo), this.contentLeft, startY, { width: 46, height: 46 });
    this.doc
      .font('Helvetica-Bold')
      .fontSize(15)
      .fillColor(BRAND.navy)
      .text('MIRQAB', this.contentLeft + 56, startY + 4, { lineBreak: false });
    this.doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(BRAND.blueGray)
      .text('Security Operations Center', this.contentLeft + 56, startY + 24, { lineBreak: false });

    const rightWidth = 220;
    const rightX = this.doc.page.width - this.doc.page.margins.right - rightWidth;
    this.doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(BRAND.purpleDark)
      .text('SECURITY OPERATIONS CENTER', rightX, startY + 6, { width: rightWidth, align: 'right' });
    this.doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(BRAND.muted)
      .text('Monitor | Detect | Respond | Protect', rightX, startY + 20, {
        width: rightWidth,
        align: 'right',
      });

    const lineY = startY + 52;
    this.doc
      .strokeColor(BRAND.purple)
      .lineWidth(2)
      .moveTo(this.contentLeft, lineY)
      .lineTo(this.doc.page.width - this.doc.page.margins.right, lineY)
      .stroke();

    this.doc.y = lineY + 18;
    this.doc.font('Helvetica-Bold').fontSize(21).fillColor(BRAND.navy).text(title, { align: 'center' });
    this.doc.moveDown(0.25);
    this.doc
      .font('Helvetica')
      .fontSize(11)
      .fillColor(BRAND.blueGray)
      // pdfkit's standard Helvetica font only supports WinAnsi encoding,
      // which has no glyph for U+2192 (→) — it silently renders as the
      // wrong characters instead of throwing. Callers must use plain ASCII
      // "-" in `subtitle`, never "→" (see weekly-report-pdf.util.ts's
      // periodLabel and case-report-pdf.util.ts's equivalent).
      .text(subtitle, { align: 'center' });
    this.doc.moveDown(0.9);
    return this;
  }

  /** Horizontal light metadata card — Organization / Report Period /
   * Prepared By / Generated At / Generation Source, separated by thin
   * dividers rather than a plain key:value list. */
  metadataCard(fields: Array<{ label: string; value: string }>): this {
    this.ensureSpace(50);
    const x = this.contentLeft;
    const y = this.doc.y;
    const width = this.contentWidth;
    const height = 44;
    this.doc.roundedRect(x, y, width, height, 8).fill(BRAND.cardGray);
    this.doc.roundedRect(x, y, width, height, 8).lineWidth(1).strokeColor(BRAND.border).stroke();

    const colWidth = width / fields.length;
    fields.forEach((field, i) => {
      const colX = x + i * colWidth;
      if (i > 0) {
        this.doc
          .strokeColor(BRAND.border)
          .lineWidth(1)
          .moveTo(colX, y + 8)
          .lineTo(colX, y + height - 8)
          .stroke();
      }
      const textX = colX + (i === 0 ? 14 : 12);
      const textWidth = colWidth - (i === 0 ? 20 : 16);
      this.doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor(BRAND.muted)
        .text(field.label.toUpperCase(), textX, y + 9, { width: textWidth });
      this.doc
        .font('Helvetica-Bold')
        .fontSize(9.5)
        .fillColor(BRAND.navy)
        .text(field.value, textX, y + 21, { width: textWidth, ellipsis: true });
    });

    this.doc.y = y + height + 16;
    return this;
  }

  /** Section title styled with a purple accent bar — the Weekly Report's
   * equivalent of `heading()`, kept as a separate method so `heading()`
   * itself (used by CaseReportService) is never touched. */
  sectionBanner(text: string): this {
    this.ensureSpace(36);
    this.doc.moveDown(0.6);
    const y = this.doc.y;
    this.doc.rect(this.contentLeft, y, 4, 16).fill(BRAND.purple);
    this.doc
      .font('Helvetica-Bold')
      .fontSize(14)
      .fillColor(BRAND.navy)
      .text(text, this.contentLeft + 12, y - 1);
    this.doc.moveDown(0.5);
    return this;
  }

  /** Smaller sub-section title (e.g. "By Attack Type" under "Incident
   * Overview") — additive counterpart to `subheading()`. */
  subBanner(text: string): this {
    this.ensureSpace(20);
    this.doc.font('Helvetica-Bold').fontSize(10.5).fillColor(BRAND.blueGray).text(text);
    this.doc.moveDown(0.3);
    return this;
  }

  /** The Security Posture risk banner — colored strictly by the approved,
   * documented derivation rule (see weekly-report-pdf.util.ts), never a
   * stored or fabricated value. */
  securityPostureBanner(level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL', summary: string): this {
    this.ensureSpace(70);
    const color = BRAND.risk[level];
    const x = this.contentLeft;
    const y = this.doc.y;
    const width = this.contentWidth;
    const height = 54;
    this.doc.roundedRect(x, y, width, height, 8).fill(BRAND.cardLavender);
    this.doc.rect(x, y, 5, height).fill(color);

    this.doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(BRAND.muted)
      .text('OVERALL SECURITY RISK', x + 18, y + 10);
    this.doc.font('Helvetica-Bold').fontSize(16).fillColor(color).text(level, x + 18, y + 22);

    this.doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(BRAND.navy)
      .text(summary, x + 150, y + 12, { width: width - 165 });

    this.doc.y = y + height + 14;
    return this;
  }

  /** A responsive grid of KPI cards — icon accent (a simple colored dot,
   * not a pictogram font/SVG library pdfkit doesn't have), large number,
   * label. Real values only — every caller passes numbers straight out of
   * WeeklyReportData. */
  kpiCardGrid(cards: Array<{ label: string; value: string; accent?: string }>, perRow = 4): this {
    const gap = 10;
    const cardWidth = (this.contentWidth - gap * (perRow - 1)) / perRow;
    const cardHeight = 56;

    for (let i = 0; i < cards.length; i += perRow) {
      this.ensureSpace(cardHeight + gap);
      const rowY = this.doc.y;
      const rowCards = cards.slice(i, i + perRow);
      rowCards.forEach((card, col) => {
        const x = this.contentLeft + col * (cardWidth + gap);
        const accent = card.accent ?? BRAND.purple;
        this.doc.roundedRect(x, rowY, cardWidth, cardHeight, 8).fill(BRAND.cardGray);
        this.doc
          .roundedRect(x, rowY, cardWidth, cardHeight, 8)
          .lineWidth(1)
          .strokeColor(BRAND.border)
          .stroke();
        this.doc.circle(x + 14, rowY + 14, 3.5).fill(accent);
        this.doc
          .font('Helvetica-Bold')
          .fontSize(18)
          .fillColor(BRAND.navy)
          .text(card.value, x + 10, rowY + 20, { width: cardWidth - 20 });
        this.doc
          .font('Helvetica')
          .fontSize(7.5)
          .fillColor(BRAND.muted)
          .text(card.label.toUpperCase(), x + 10, rowY + 42, { width: cardWidth - 20 });
      });
      this.doc.y = rowY + cardHeight + gap;
    }
    this.doc.moveDown(0.3);
    return this;
  }

  /** Draws one ring segment as a thick stroked polyline approximation of an
   * arc (pdfkit has no native partial-arc stroke primitive) — smooth enough
   * at print resolution and avoids any SVG arc-flag edge cases. */
  private ringSegment(
    cx: number,
    cy: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    thickness: number,
    color: string,
  ): void {
    const steps = Math.max(2, Math.ceil((Math.abs(endAngle - startAngle) / (Math.PI * 2)) * 160));
    this.doc.save();
    this.doc.lineWidth(thickness).strokeColor(color).lineCap('butt');
    this.doc.moveTo(cx + radius * Math.cos(startAngle), cy + radius * Math.sin(startAngle));
    for (let i = 1; i <= steps; i++) {
      const t = startAngle + (endAngle - startAngle) * (i / steps);
      this.doc.lineTo(cx + radius * Math.cos(t), cy + radius * Math.sin(t));
    }
    this.doc.stroke();
    this.doc.restore();
  }

  /** Alerts-by-Severity donut chart — real values only. When every value is
   * zero, draws a neutral empty ring instead of fabricating a distribution,
   * per requirement #4/#35. */
  donutChart(
    segments: Array<{ label: string; value: number; color: string }>,
    centerLabel: string,
  ): this {
    const total = segments.reduce((sum, s) => sum + s.value, 0);
    this.ensureSpace(160);
    const boxY = this.doc.y;
    const cx = this.contentLeft + 80;
    const cy = boxY + 75;
    const radius = 55;
    const thickness = 22;

    if (total === 0) {
      this.ringSegment(cx, cy, radius, -Math.PI / 2, (3 * Math.PI) / 2, thickness, BRAND.border);
    } else {
      let angle = -Math.PI / 2;
      for (const seg of segments) {
        if (seg.value <= 0) continue;
        const sweep = (seg.value / total) * Math.PI * 2;
        this.ringSegment(cx, cy, radius, angle, angle + sweep, thickness, seg.color);
        angle += sweep;
      }
    }

    this.doc
      .font('Helvetica-Bold')
      .fontSize(20)
      .fillColor(BRAND.navy)
      .text(String(total), cx - 40, cy - 12, { width: 80, align: 'center' });
    this.doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(BRAND.muted)
      .text(centerLabel.toUpperCase(), cx - 40, cy + 10, { width: 80, align: 'center' });

    const legendX = this.contentLeft + 175;
    let legendY = boxY + 14;
    for (const seg of segments) {
      const pct = total > 0 ? Math.round((seg.value / total) * 1000) / 10 : 0;
      this.doc.rect(legendX, legendY + 2, 9, 9).fill(seg.color);
      this.doc
        .font('Helvetica')
        .fontSize(9.5)
        .fillColor(BRAND.navy)
        .text(`${seg.label}  ${seg.value} (${pct}%)`, legendX + 15, legendY);
      legendY += 20;
    }

    this.doc.y = boxY + 160;
    return this;
  }

  /** Professional bordered/striped data table with automatic pagination —
   * repeats the header row on any page it spills onto. `colorize` lets a
   * caller tint one cell's text (e.g. severity/risk) without turning this
   * into a severity-aware component. */
  dataTable(
    columns: Array<{ header: string; width: number }>,
    rows: string[][],
    opts: { emptyMessage?: string; colorize?: (row: string[], colIndex: number) => string | null } = {},
  ): this {
    if (rows.length === 0) {
      this.ensureSpace(40);
      const y = this.doc.y;
      this.doc.roundedRect(this.contentLeft, y, this.contentWidth, 34, 6).fill(BRAND.cardGray);
      this.doc
        .font('Helvetica-Oblique')
        .fontSize(9.5)
        .fillColor(BRAND.muted)
        .text(opts.emptyMessage ?? 'No data available for this reporting period.', this.contentLeft, y + 12, {
          width: this.contentWidth,
          align: 'center',
        });
      this.doc.y = y + 34 + 12;
      return this;
    }

    const rowHeight = 22;
    const headerHeight = 22;
    const totalWidth = columns.reduce((sum, c) => sum + c.width, 0);
    const scale = this.contentWidth / totalWidth;

    const drawHeader = () => {
      const y = this.doc.y;
      this.doc.rect(this.contentLeft, y, this.contentWidth, headerHeight).fill(BRAND.purpleTint);
      let x = this.contentLeft;
      for (const col of columns) {
        const w = col.width * scale;
        this.doc
          .font('Helvetica-Bold')
          .fontSize(8)
          .fillColor(BRAND.purpleDark)
          .text(col.header.toUpperCase(), x + 6, y + 7, { width: w - 10 });
        x += w;
      }
      this.doc.y = y + headerHeight;
    };

    this.ensureSpace(headerHeight + rowHeight);
    drawHeader();

    rows.forEach((row, rowIndex) => {
      if (this.doc.y + rowHeight > this.doc.page.height - this.doc.page.margins.bottom) {
        this.doc.addPage();
        drawHeader();
      }
      const y = this.doc.y;
      if (rowIndex % 2 === 1) {
        this.doc.rect(this.contentLeft, y, this.contentWidth, rowHeight).fill(BRAND.cardGray);
      }
      let x = this.contentLeft;
      row.forEach((cell, colIndex) => {
        const w = columns[colIndex].width * scale;
        const tint = opts.colorize?.(row, colIndex);
        this.doc
          .font(tint ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(8.5)
          .fillColor(tint ?? BRAND.navy)
          .text(cell, x + 6, y + 6, { width: w - 10, height: rowHeight - 6, ellipsis: true });
        x += w;
      });
      this.doc
        .strokeColor(BRAND.border)
        .lineWidth(0.5)
        .moveTo(this.contentLeft, y + rowHeight)
        .lineTo(this.contentLeft + this.contentWidth, y + rowHeight)
        .stroke();
      this.doc.y = y + rowHeight;
    });

    this.doc.moveDown(0.8);
    return this;
  }

  /** One structured "Incident Resolution Detail" card — every field comes
   * from a real stored column; the caller passes 'Not available' verbatim
   * for anything null rather than this method inventing a placeholder. */
  incidentDetailCard(
    caseId: string,
    severityColor: string,
    sections: Array<{ label: string; value: string }>,
  ): this {
    this.ensureSpace(40);
    this.doc.moveDown(0.4);
    const startY = this.doc.y;
    this.doc.rect(this.contentLeft, startY, 4, 14).fill(severityColor);
    this.doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor(BRAND.navy)
      .text(`INCIDENT: ${caseId}`, this.contentLeft + 12, startY - 1);
    this.doc.moveDown(0.5);

    for (const section of sections) {
      this.ensureSpace(28);
      this.doc
        .font('Helvetica-Bold')
        .fontSize(8)
        .fillColor(BRAND.purpleDark)
        .text(section.label.toUpperCase());
      this.doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor(BRAND.navy)
        .text(section.value || 'Not available.');
      this.doc.moveDown(0.35);
    }
    this.doc.moveDown(0.4);
    this.divider();
    return this;
  }

  /** Replaces `pageNumbers()` for the Weekly Report only — richer footer
   * with logo/branding on the left, page count + generation timestamp on
   * the right, and a thin purple line above. `pageNumbers()` itself is
   * untouched for CaseReportService. */
  premiumFooter(logo: Buffer, generatedOnLabel: string): void {
    const range = this.doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      this.doc.switchToPage(i);
      const bottom = this.doc.page.height - 34;
      this.doc
        .strokeColor(BRAND.purple)
        .lineWidth(1)
        .moveTo(this.contentLeft, bottom - 10)
        .lineTo(this.doc.page.width - this.doc.page.margins.right, bottom - 10)
        .stroke();

      this.doc.image(this.openImageOnce(logo), this.contentLeft, bottom - 2, { width: 14, height: 14 });
      this.doc
        .font('Helvetica-Bold')
        .fontSize(7.5)
        .fillColor(BRAND.navy)
        .text('MIRQAB — Security Operations Center', this.contentLeft + 18, bottom - 1, {
          lineBreak: false,
        });
      this.doc
        .font('Helvetica')
        .fontSize(7)
        .fillColor(BRAND.muted)
        .text('Confidential | Internal Use Only', this.contentLeft + 18, bottom + 9, {
          lineBreak: false,
        });

      const rightWidth = 220;
      const rightX = this.doc.page.width - this.doc.page.margins.right - rightWidth;
      this.doc
        .font('Helvetica-Bold')
        .fontSize(7.5)
        .fillColor(BRAND.navy)
        .text(`Page ${i + 1} of ${range.count}`, rightX, bottom - 1, {
          width: rightWidth,
          align: 'right',
        });
      this.doc
        .font('Helvetica')
        .fontSize(7)
        .fillColor(BRAND.muted)
        .text(generatedOnLabel, rightX, bottom + 9, { width: rightWidth, align: 'right' });
    }
  }
}
