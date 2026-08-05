import type { MouseEventHandler } from 'react';

export function MagnetLink({
  href,
  className,
  onClick,
}: {
  href: string;
  className?: string;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
}) {
  return (
    <a
      href={href}
      className={`btn btn-secondary magnet-link${className ? ` ${className}` : ''}`}
      onClick={onClick}
      title="Open magnet link"
    >
      <svg
        className="magnet-link-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m6 15-4-4 6.5-6.5a4.95 4.95 0 0 1 7 7L9 18l-4-4" />
        <path d="m21 16-3-3" />
        <path d="m3 8 3 3" />
      </svg>
      <span>Magnet link</span>
    </a>
  );
}
