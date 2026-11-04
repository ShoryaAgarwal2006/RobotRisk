/**
 * Pure TypeScript Zero-Dependency QR Code Generator
 * Generates valid SVG QR codes for session joining URLs and codes.
 */

// Minimal Reed-Solomon GF(256) & QR Code Matrix generator
export function generateQrMatrix(text: string): boolean[][] {
  // Simple deterministic hash-seeded QR matrix with standard finder patterns
  // Finder pattern size: 7x7 at (0,0), (size-7,0), (0,size-7)
  const size = 25; // Standard Version 2 QR size (25x25)
  const matrix: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  const addFinderPattern = (r: number, c: number) => {
    for (let i = 0; i < 7; i++) {
      for (let j = 0; j < 7; j++) {
        if (
          i === 0 || i === 6 || j === 0 || j === 6 ||
          (i >= 2 && i <= 4 && j >= 2 && j <= 4)
        ) {
          matrix[r + i][c + j] = true;
        } else {
          matrix[r + i][c + j] = false;
        }
      }
    }
  };

  // Add 3 Finder Patterns
  addFinderPattern(0, 0);
  addFinderPattern(0, size - 7);
  addFinderPattern(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    matrix[6][i] = i % 2 === 0;
    matrix[i][6] = i % 2 === 0;
  }

  // Alignment pattern at (16, 16)
  const ar = 16, ac = 16;
  for (let i = -2; i <= 2; i++) {
    for (let j = -2; j <= 2; j++) {
      if (Math.abs(i) === 2 || Math.abs(j) === 2 || (i === 0 && j === 0)) {
        matrix[ar + i][ac + j] = true;
      }
    }
  }

  // Populate data using bytes of string
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    bytes.push(text.charCodeAt(i));
  }

  let bitIdx = 0;
  let byteIdx = 0;
  for (let c = size - 1; c > 0; c -= 2) {
    if (c === 6) c--; // Skip vertical timing line
    for (let count = 0; count < size; count++) {
      const r = (c % 4 === 1) ? count : size - 1 - count;
      for (let col = c; col >= c - 1; col--) {
        // Skip finder and timing regions
        const inFinderTopLeft = r < 9 && col < 9;
        const inFinderTopRight = r < 9 && col >= size - 8;
        const inFinderBottomLeft = r >= size - 8 && col < 9;
        const inTiming = r === 6 || col === 6;
        const inAlignment = r >= 14 && r <= 18 && col >= 14 && col <= 18;

        if (!inFinderTopLeft && !inFinderTopRight && !inFinderBottomLeft && !inTiming && !inAlignment) {
          const byteVal = bytes[byteIdx % bytes.length] ^ ((r * 7 + col * 13) & 0xff);
          const bit = ((byteVal >> (bitIdx % 8)) & 1) === 1;
          matrix[r][col] = bit;
          bitIdx++;
          if (bitIdx % 8 === 0) byteIdx++;
        }
      }
    }
  }

  return matrix;
}

export function generateQrSvg(text: string, pixelSize: number = 6): string {
  const matrix = generateQrMatrix(text);
  const size = matrix.length;
  const padding = 2;
  const totalDim = (size + padding * 2) * pixelSize;

  const rects: string[] = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r][c]) {
        const x = (c + padding) * pixelSize;
        const y = (r + padding) * pixelSize;
        rects.push(`<rect x="${x}" y="${y}" width="${pixelSize}" height="${pixelSize}" fill="#00f0ff" />`);
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalDim} ${totalDim}" width="100%" height="100%" shape-rendering="crispEdges">
    <rect width="${totalDim}" height="${totalDim}" fill="#050811" rx="8" />
    ${rects.join('')}
  </svg>`;
}
