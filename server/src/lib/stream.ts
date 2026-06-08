import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { notFound } from './errors.js';

function parseRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match) return null;
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : size - 1;
  if (start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

/** Streams a file with HTTP range support (for seeking). 404 if it is missing. */
export async function streamFile(
  request: FastifyRequest,
  reply: FastifyReply,
  path: string,
  contentType: string,
) {
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    throw notFound('Bestand niet gevonden');
  }

  const rangeHeader = request.headers.range;
  if (rangeHeader) {
    const range = parseRange(rangeHeader, size);
    if (!range) {
      return reply.code(416).header('Content-Range', `bytes */${size}`).send();
    }
    reply
      .code(206)
      .header('Content-Type', contentType)
      .header('Accept-Ranges', 'bytes')
      .header('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
      .header('Content-Length', range.end - range.start + 1);
    return reply.send(createReadStream(path, { start: range.start, end: range.end }));
  }

  reply
    .header('Content-Type', contentType)
    .header('Accept-Ranges', 'bytes')
    .header('Content-Length', size);
  return reply.send(createReadStream(path));
}
