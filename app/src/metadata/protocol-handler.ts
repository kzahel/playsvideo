import { parseMediaMetadata } from '../media-metadata.js';
import { directTmdbMetadataClient } from './direct-tmdb.js';
import {
  MetadataTransportCooldownError,
  MetadataTransportInvalidError,
} from './coordinator.js';
import { metadataRepository } from './repository.js';
import type {
  MetadataErrorResponse,
  MetadataGetMovieRequest,
  MetadataGetSeasonRequest,
  MetadataGetSeriesRequest,
  MetadataGetTransportStateRequest,
  MetadataInvalidateRequest,
  MetadataMatchMovieRequest,
  MetadataMatchTvRequest,
  MetadataRequestEnvelope,
  MetadataResponseEnvelope,
} from '../../../src/metadata-protocol.js';

export async function handleMetadataRequest(
  request: MetadataRequestEnvelope,
): Promise<MetadataResponseEnvelope> {
  const { id, message } = request;

  switch (message.type) {
    case 'metadata:parse-filename':
      return {
        id,
        message: {
          type: 'metadata:parse-filename:success',
          parsed: parseMediaMetadata(message.path),
        },
      };

    case 'metadata:refresh-library':
      await directTmdbMetadataClient.refreshLibraryMetadata(message.options);
      return {
        id,
        message: {
          type: 'metadata:refresh-library:success',
        },
      };

    case 'metadata:refresh-series-seasons':
      await directTmdbMetadataClient.refreshSeriesSeasons(message.options);
      return {
        id,
        message: {
          type: 'metadata:refresh-series-seasons:success',
        },
      };

    case 'metadata:match-tv':
    case 'metadata:get-series':
      return handleSeriesLookup(id, message);

    case 'metadata:match-movie':
    case 'metadata:get-movie':
      return handleMovieLookup(id, message);

    case 'metadata:get-season':
      return handleSeasonLookup(id, message);

    case 'metadata:get-transport-state':
      return handleTransportState(id, message);

    case 'metadata:invalidate':
      return handleInvalidate(id, message);
  }
}

export function isMetadataRequestEnvelope(value: unknown): value is MetadataRequestEnvelope {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'id' in value &&
      'message' in value &&
      typeof (value as { id: unknown }).id === 'string' &&
      typeof (value as { message: unknown }).message === 'object' &&
      (value as { message: { type?: unknown } }).message?.type?.toString().startsWith('metadata:'),
  );
}

export function toMetadataErrorResponse(
  id: string,
  error: unknown,
): MetadataResponseEnvelope {
  return {
    id,
    message: mapError(error),
  };
}

async function handleSeriesLookup(
  id: string,
  message: MetadataMatchTvRequest | MetadataGetSeriesRequest,
): Promise<MetadataResponseEnvelope> {
  const entry = (await metadataRepository.getSeriesMetadata(message.key)) ?? null;
  return {
    id,
    message: {
      type:
        message.type === 'metadata:match-tv'
          ? 'metadata:match-tv:success'
          : 'metadata:get-series:success',
      entry,
    },
  };
}

async function handleMovieLookup(
  id: string,
  message: MetadataMatchMovieRequest | MetadataGetMovieRequest,
): Promise<MetadataResponseEnvelope> {
  const entry = (await metadataRepository.getMovieMetadata(message.key)) ?? null;
  return {
    id,
    message: {
      type:
        message.type === 'metadata:match-movie'
          ? 'metadata:match-movie:success'
          : 'metadata:get-movie:success',
      entry,
    },
  };
}

async function handleSeasonLookup(
  id: string,
  message: MetadataGetSeasonRequest,
): Promise<MetadataResponseEnvelope> {
  const entry = (await metadataRepository.getSeasonCache(message.key)) ?? null;
  return {
    id,
    message: {
      type: 'metadata:get-season:success',
      entry,
    },
  };
}

async function handleTransportState(
  id: string,
  message: MetadataGetTransportStateRequest,
): Promise<MetadataResponseEnvelope> {
  const entries = await metadataRepository.listTransportState({
    transport: message.transport,
    credentialSlot: message.credentialSlot,
  });

  return {
    id,
    message: {
      type: 'metadata:get-transport-state:success',
      entries,
    },
  };
}

async function handleInvalidate(
  id: string,
  message: MetadataInvalidateRequest,
): Promise<MetadataResponseEnvelope> {
  await metadataRepository.invalidateMetadata(message.keys);
  return {
    id,
    message: {
      type: 'metadata:invalidate:success',
    },
  };
}

function mapError(error: unknown): MetadataErrorResponse {
  if (error instanceof MetadataTransportCooldownError) {
    return {
      type: 'metadata:error',
      code: 'cooldown',
      message: error.message,
      details: { cooldownUntil: error.cooldownUntil },
    };
  }

  if (error instanceof MetadataTransportInvalidError) {
    return {
      type: 'metadata:error',
      code: 'invalid-transport',
      message: error.message,
    };
  }

  if (error instanceof Error) {
    return {
      type: 'metadata:error',
      code: 'internal',
      message: error.message,
    };
  }

  return {
    type: 'metadata:error',
    code: 'internal',
    message: String(error),
  };
}
