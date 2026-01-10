/**
 * OceanZ Gaming Cafe - PDF Export Utility
 * Styled PDF generation with neon theme
 */

// Helper to sanitize text for PDF (replace Unicode with ASCII)
function sanitizeForPDF(text) {
  if (typeof text !== 'string') return String(text);
  return text
    .replace(/₹/g, 'Rs.')
    .replace(/✓/g, '[OK]')
    .replace(/✗/g, '[X]')
    .replace(/⚠/g, '[!]')
    .replace(/↔/g, '<->')
    .replace(/→/g, '->')
    .replace(/←/g, '<-')
    .replace(/•/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x00-\x7F]/g, ''); // Remove any remaining non-ASCII
}

// Color palette (RGB values)
const COLORS = {
  // Background
  darkBg: [15, 15, 25],
  cardBg: [25, 25, 40],
  
  // Neon colors
  neonRed: [255, 0, 68],
  neonCyan: [0, 240, 255],
  neonGreen: [0, 255, 136],
  neonPurple: [184, 41, 255],
  neonYellow: [255, 255, 0],
  neonOrange: [255, 107, 0],
  
  // Text
  white: [255, 255, 255],
  gray: [150, 150, 150],
  darkGray: [100, 100, 100],
};

/**
 * Create a styled PDF document
 * @param {Object} options - Configuration options
 * @returns {jsPDF} - The PDF document
 */
function createStyledPDF(options = {}) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({
    orientation: options.orientation || 'portrait',
    unit: 'mm',
    format: 'a4'
  });
  
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  
  // Dark background
  doc.setFillColor(...COLORS.darkBg);
  doc.rect(0, 0, pageWidth, pageHeight, 'F');
  
  return doc;
}

/**
 * Add header to PDF
 * @param {jsPDF} doc - The PDF document
 * @param {string} title - Header title
 * @param {string} subtitle - Optional subtitle
 */
function addPDFHeader(doc, title, subtitle = '') {
  const pageWidth = doc.internal.pageSize.getWidth();
  
  // Header background with gradient effect
  doc.setFillColor(...COLORS.cardBg);
  doc.rect(0, 0, pageWidth, 35, 'F');
  
  // Top accent line
  doc.setDrawColor(...COLORS.neonRed);
  doc.setLineWidth(1);
  doc.line(0, 0, pageWidth, 0);
  
  // Logo placeholder (hexagon)
  doc.setDrawColor(...COLORS.neonRed);
  doc.setLineWidth(0.5);
  const logoX = 15;
  const logoY = 17;
  const logoSize = 8;
  // Simple hexagon approximation
  doc.setFillColor(...COLORS.darkBg);
  doc.circle(logoX, logoY, logoSize, 'FD');
  
  // Brand text
  doc.setTextColor(...COLORS.neonRed);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('OCEANZ', 28, 14);
  
  doc.setTextColor(...COLORS.gray);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text('GAMING CAFE', 28, 20);
  
  // Title
  doc.setTextColor(...COLORS.neonCyan);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(sanitizeForPDF(title.toUpperCase()), pageWidth - 15, 14, { align: 'right' });
  
  // Subtitle (date/info)
  if (subtitle) {
    doc.setTextColor(...COLORS.gray);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(sanitizeForPDF(subtitle), pageWidth - 15, 22, { align: 'right' });
  }
  
  // Bottom border line
  doc.setDrawColor(...COLORS.neonPurple);
  doc.setLineWidth(0.5);
  doc.line(10, 32, pageWidth - 10, 32);
  
  return 40; // Return Y position after header
}

/**
 * Add summary cards to PDF
 * @param {jsPDF} doc - The PDF document
 * @param {Array} stats - Array of {label, value, color} objects
 * @param {number} startY - Starting Y position
 */
function addPDFSummary(doc, stats, startY) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const cardWidth = (pageWidth - 30 - (stats.length - 1) * 5) / stats.length;
  const cardHeight = 20;
  
  stats.forEach((stat, i) => {
    const x = 15 + i * (cardWidth + 5);
    
    // Card background
    doc.setFillColor(...COLORS.cardBg);
    doc.roundedRect(x, startY, cardWidth, cardHeight, 3, 3, 'F');
    
    // Accent line at bottom
    const accentColor = COLORS[stat.color] || COLORS.neonCyan;
    doc.setDrawColor(...accentColor);
    doc.setLineWidth(1);
    doc.line(x, startY + cardHeight, x + cardWidth, startY + cardHeight);
    
    // Label
    doc.setTextColor(...COLORS.gray);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.text(sanitizeForPDF(stat.label.toUpperCase()), x + cardWidth / 2, startY + 7, { align: 'center' });
    
    // Value
    doc.setTextColor(...accentColor);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(sanitizeForPDF(stat.value), x + cardWidth / 2, startY + 15, { align: 'center' });
  });
  
  return startY + cardHeight + 10;
}

/**
 * Add a styled table to PDF
 * @param {jsPDF} doc - The PDF document
 * @param {Array} headers - Table headers
 * @param {Array} data - Table data (2D array)
 * @param {number} startY - Starting Y position
 * @param {Object} options - Table options
 */
function addPDFTable(doc, headers, data, startY, options = {}) {
  const columnStyles = options.columnStyles || {};
  
  // Sanitize headers and data
  const cleanHeaders = headers.map(h => sanitizeForPDF(h));
  const cleanData = data.map(row => row.map(cell => sanitizeForPDF(cell)));
  
  doc.autoTable({
    head: [cleanHeaders],
    body: cleanData,
    startY: startY,
    theme: 'plain',
    styles: {
      fillColor: COLORS.darkBg,
      textColor: COLORS.white,
      fontSize: 9,
      cellPadding: 4,
      lineColor: [40, 40, 60],
      lineWidth: 0.1,
    },
    headStyles: {
      fillColor: COLORS.cardBg,
      textColor: COLORS.neonCyan,
      fontSize: 8,
      fontStyle: 'bold',
      cellPadding: 5,
    },
    alternateRowStyles: {
      fillColor: [20, 20, 35],
    },
    columnStyles: columnStyles,
    margin: { left: 15, right: 15 },
    didDrawCell: function(data) {
      // Add colored accents for specific columns if needed
      if (options.colorColumns && options.colorColumns[data.column.index]) {
        const color = options.colorColumns[data.column.index];
        if (data.section === 'body') {
          doc.setTextColor(...(COLORS[color] || COLORS.white));
        }
      }
    },
    willDrawCell: function(data) {
      // Custom cell coloring based on content
      if (options.statusColumn === data.column.index && data.section === 'body') {
        const cellText = data.cell.text[0]?.toLowerCase() || '';
        if (cellText.includes('matched') || cellText.includes('approved') || cellText.includes('cash')) {
          doc.setTextColor(...COLORS.neonGreen);
        } else if (cellText.includes('pending') || cellText.includes('mismatch') || cellText.includes('upi')) {
          doc.setTextColor(...COLORS.neonPurple);
        } else if (cellText.includes('admin-only') || cellText.includes('credit')) {
          doc.setTextColor(...COLORS.neonOrange);
        } else if (cellText.includes('pancafe-only') || cellText.includes('declined')) {
          doc.setTextColor(...COLORS.neonRed);
        }
      }
    }
  });
  
  return doc.lastAutoTable.finalY + 10;
}

/**
 * Add footer to PDF
 * @param {jsPDF} doc - The PDF document
 */
function addPDFFooter(doc) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageCount = doc.internal.getNumberOfPages();
  
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    
    // Footer line
    doc.setDrawColor(...COLORS.neonRed);
    doc.setLineWidth(0.3);
    doc.line(15, pageHeight - 15, pageWidth - 15, pageHeight - 15);
    
    // Footer text
    doc.setTextColor(...COLORS.darkGray);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    
    const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    doc.text(`Generated: ${now}`, 15, pageHeight - 10);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - 15, pageHeight - 10, { align: 'right' });
    
    // Watermark
    doc.setTextColor(30, 30, 45);
    doc.setFontSize(6);
    doc.text('OCEANZ GAMING CAFE - CONFIDENTIAL', pageWidth / 2, pageHeight - 10, { align: 'center' });
  }
}

/**
 * Add page break with styled background
 * @param {jsPDF} doc - The PDF document
 */
function addPageBreak(doc) {
  doc.addPage();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  
  // Dark background for new page
  doc.setFillColor(...COLORS.darkBg);
  doc.rect(0, 0, pageWidth, pageHeight, 'F');
  
  return 15; // Return starting Y position
}

/**
 * Save PDF with filename
 * @param {jsPDF} doc - The PDF document
 * @param {string} filename - Filename without extension
 */
function savePDF(doc, filename) {
  addPDFFooter(doc);
  doc.save(`${filename}.pdf`);
}

// Export to window for global access
window.PDFExport = {
  createStyledPDF,
  addPDFHeader,
  addPDFSummary,
  addPDFTable,
  addPDFFooter,
  addPageBreak,
  savePDF,
  COLORS
};

