import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db.js';
import { groupMovies, groupTvShows } from '../library-groups.js';

function buildFallbackLabel(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function formatYear(value?: string | number): string | null {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string' && value.length >= 4) return value.slice(0, 4);
  return null;
}

type MediaBrowserMode = 'all' | 'shows' | 'movies';

function MediaBrowserContent({ mode }: { mode: MediaBrowserMode }) {
  const entries = useLiveQuery(() => db.library.toArray());
  const seriesMetadata = useLiveQuery(() => db.seriesMetadata.toArray());

  if (entries === undefined || seriesMetadata === undefined) {
    return <div className="empty-state">Loading...</div>;
  }

  const metadataByKey = new Map(seriesMetadata.map((entry) => [entry.key, entry]));
  const tvShows = groupTvShows(entries, metadataByKey);
  const movies = groupMovies(entries);

  return (
    <div className="media-browser-page">
      {(mode === 'all' || mode === 'shows') && (
        <section className="media-section">
          <div className="media-section-header">
            <h1>Shows</h1>
            <span>{tvShows.length}</span>
          </div>
          {tvShows.length === 0 ? (
            <div className="empty-state">No TV shows detected yet.</div>
          ) : (
            <div className="media-grid">
              {tvShows.map((show) => {
                const posterUrl = show.seriesMetadata?.posterUrl;
                const imageUrl = posterUrl ?? show.seriesMetadata?.backdropUrl;
                const seasonCount = new Set(
                  show.entries
                    .map((entry) => entry.seasonNumber)
                    .filter((seasonNumber): seasonNumber is number => seasonNumber != null),
                ).size;
                const year = formatYear(show.seriesMetadata?.firstAirDate ?? show.year);
                return (
                  <Link
                    key={show.id}
                    to={`/tv/${encodeURIComponent(show.slug)}`}
                    className={`media-card${posterUrl ? ' media-card-poster' : ''}`}
                  >
                    <div className="media-card-art">
                      {imageUrl ? (
                        <img src={imageUrl} alt={show.title} loading="lazy" />
                      ) : (
                        <div className="media-card-fallback">{buildFallbackLabel(show.title)}</div>
                      )}
                    </div>
                    <div className="media-card-body">
                      <div className="media-card-title">{show.title}</div>
                      <div className="media-card-meta">
                        {year ?? 'Unknown year'}
                        {seasonCount > 0 ? ` · ${seasonCount} season${seasonCount === 1 ? '' : 's'}` : ''}
                        {` · ${show.entries.length} episode${show.entries.length === 1 ? '' : 's'}`}
                      </div>
                      {show.seriesMetadata?.overview ? (
                        <div className="media-card-overview">{show.seriesMetadata.overview}</div>
                      ) : null}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      )}

      {(mode === 'all' || mode === 'movies') && (
        <section className="media-section">
          <div className="media-section-header">
            <h1>Movies</h1>
            <span>{movies.length}</span>
          </div>
          {movies.length === 0 ? (
            <div className="empty-state">No movies detected yet.</div>
          ) : (
            <div className="media-grid">
              {movies.map((movie) => (
                <Link
                  key={movie.id}
                  to={`/movie/${encodeURIComponent(movie.slug)}`}
                  className="media-card media-card-poster"
                >
                  <div className="media-card-art">
                    <div className="media-card-fallback">{buildFallbackLabel(movie.title)}</div>
                  </div>
                  <div className="media-card-body">
                    <div className="media-card-title">{movie.title}</div>
                    <div className="media-card-meta">
                      {movie.year ?? 'Unknown year'} · {movie.entries.length} file
                      {movie.entries.length === 1 ? '' : 's'}
                    </div>
                    <div className="media-card-overview">
                      {movie.entries.length === 1
                        ? movie.entries[0].name
                        : movie.entries.map((entry) => entry.name).join(' · ')}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export function MediaBrowser() {
  return <MediaBrowserContent mode="all" />;
}

export function ShowsBrowser() {
  return <MediaBrowserContent mode="shows" />;
}

export function MoviesBrowser() {
  return <MediaBrowserContent mode="movies" />;
}
