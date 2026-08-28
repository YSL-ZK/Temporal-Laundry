import type { CSSProperties } from "react";

type LaundryMarkProps = {
  className?: string;
  label?: string;
  style?: CSSProperties;
};

export function LaundryMarkSvg({ className, label, style }: LaundryMarkProps) {
  return (
    <svg
      className={className}
      style={style}
      viewBox="0 0 48 48"
      fill="none"
      role={label ? "img" : undefined}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M8.75 25.2c0-8.92 6.82-16.15 15.25-16.15 6.04 0 11.26 3.72 13.73 9.12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M39.25 22.8c0 8.92-6.82 16.15-15.25 16.15-6.04 0-11.26-3.72-13.73-9.12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="9.55" cy="31.4" r="2.25" fill="currentColor" />
      <circle cx="38.45" cy="16.6" r="2.25" fill="currentColor" />
      <path d="M14.9 17.15c4.86 0 8.1 1.73 9.1 4.72v12.28c-1-2.98-4.24-4.72-9.1-4.72V17.15Z" stroke="currentColor" strokeWidth="2.3" strokeLinejoin="round" />
      <path d="M33.1 17.15c-4.86 0-8.1 1.73-9.1 4.72v12.28c1-2.98 4.24-4.72 9.1-4.72V17.15Z" stroke="currentColor" strokeWidth="2.3" strokeLinejoin="round" />
      <path d="M18.2 21.25h2.55M27.25 21.25h2.55" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export default function LaundryMark({ className = "", label }: LaundryMarkProps) {
  return <span className={`laundry-mark ${className}`.trim()}><LaundryMarkSvg label={label} /></span>;
}
