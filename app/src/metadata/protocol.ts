import type {
  MetadataCredentialSlot,
  MetadataSeasonCacheEntry,
  MetadataTransportKind,
  MetadataTransportStateEntry,
  MovieMetadataEntry,
  SeriesMetadataEntry,
} from '../db.js';
import type { ParsedMediaMetadata } from '../media-metadata.js';
import type {
  RefreshLibraryMetadataOptions,
  RefreshSeriesSeasonsOptions,
} from './types.js';

export type MetadataMessageId = string;

export interface MetadataProtocolEnvelope<TMessage> {
  id: MetadataMessageId;
  message: TMessage;
}

export interface MetadataParseFilenameRequest {
  type: 'metadata:parse-filename';
  path: string;
}

export interface MetadataRefreshLibraryRequest {
  type: 'metadata:refresh-library';
  options?: RefreshLibraryMetadataOptions;
}

export interface MetadataRefreshSeriesSeasonsRequest {
  type: 'metadata:refresh-series-seasons';
  options: RefreshSeriesSeasonsOptions;
}

export interface MetadataMatchTvRequest {
  type: 'metadata:match-tv';
  key: string;
}

export interface MetadataMatchMovieRequest {
  type: 'metadata:match-movie';
  key: string;
}

export interface MetadataGetSeriesRequest {
  type: 'metadata:get-series';
  key: string;
}

export interface MetadataGetMovieRequest {
  type: 'metadata:get-movie';
  key: string;
}

export interface MetadataGetSeasonRequest {
  type: 'metadata:get-season';
  key: string;
}

export interface MetadataGetTransportStateRequest {
  type: 'metadata:get-transport-state';
  transport?: MetadataTransportKind;
  credentialSlot?: MetadataCredentialSlot;
}

export interface MetadataInvalidateRequest {
  type: 'metadata:invalidate';
  keys?: string[];
}

export type MetadataRequestMessage =
  | MetadataParseFilenameRequest
  | MetadataRefreshLibraryRequest
  | MetadataRefreshSeriesSeasonsRequest
  | MetadataMatchTvRequest
  | MetadataMatchMovieRequest
  | MetadataGetSeriesRequest
  | MetadataGetMovieRequest
  | MetadataGetSeasonRequest
  | MetadataGetTransportStateRequest
  | MetadataInvalidateRequest;

export type MetadataRequestEnvelope = MetadataProtocolEnvelope<MetadataRequestMessage>;

export interface MetadataParseFilenameSuccess {
  type: 'metadata:parse-filename:success';
  parsed: ParsedMediaMetadata;
}

export interface MetadataRefreshLibrarySuccess {
  type: 'metadata:refresh-library:success';
}

export interface MetadataRefreshSeriesSeasonsSuccess {
  type: 'metadata:refresh-series-seasons:success';
}

export interface MetadataMatchTvSuccess {
  type: 'metadata:match-tv:success';
  entry: SeriesMetadataEntry | null;
}

export interface MetadataMatchMovieSuccess {
  type: 'metadata:match-movie:success';
  entry: MovieMetadataEntry | null;
}

export interface MetadataGetSeriesSuccess {
  type: 'metadata:get-series:success';
  entry: SeriesMetadataEntry | null;
}

export interface MetadataGetMovieSuccess {
  type: 'metadata:get-movie:success';
  entry: MovieMetadataEntry | null;
}

export interface MetadataGetSeasonSuccess {
  type: 'metadata:get-season:success';
  entry: MetadataSeasonCacheEntry | null;
}

export interface MetadataGetTransportStateSuccess {
  type: 'metadata:get-transport-state:success';
  entries: MetadataTransportStateEntry[];
}

export interface MetadataInvalidateSuccess {
  type: 'metadata:invalidate:success';
}

export interface MetadataErrorResponse {
  type: 'metadata:error';
  code:
    | 'unknown-message'
    | 'cooldown'
    | 'invalid-transport'
    | 'not-found'
    | 'unauthorized'
    | 'internal';
  message: string;
  details?: Record<string, unknown>;
}

export type MetadataResponseMessage =
  | MetadataParseFilenameSuccess
  | MetadataRefreshLibrarySuccess
  | MetadataRefreshSeriesSeasonsSuccess
  | MetadataMatchTvSuccess
  | MetadataMatchMovieSuccess
  | MetadataGetSeriesSuccess
  | MetadataGetMovieSuccess
  | MetadataGetSeasonSuccess
  | MetadataGetTransportStateSuccess
  | MetadataInvalidateSuccess
  | MetadataErrorResponse;

export type MetadataResponseEnvelope = MetadataProtocolEnvelope<MetadataResponseMessage>;

export function isMetadataErrorResponse(
  response: MetadataResponseEnvelope,
): response is MetadataProtocolEnvelope<MetadataErrorResponse> {
  return response.message.type === 'metadata:error';
}
