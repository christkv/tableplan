export const PRODUCT_NAME = "Table Rhythm";
export const PRODUCT_DOMAIN = "tablerhythm.com";
export const PRODUCT_STAGE = "Alpha";

export function BrandMark({ className = "" }: { className?: string }) {
  return <span className={`brand-mark${className ? ` ${className}` : ""}`} aria-hidden="true">
    <svg viewBox="0 0 24 24" role="img">
      <path d="M5.5 6.75h13M5.5 12h13M5.5 17.25h13" />
      <circle cx="9" cy="6.75" r="1.8" />
      <circle cx="15" cy="12" r="1.8" />
      <circle cx="11.5" cy="17.25" r="1.8" />
    </svg>
  </span>;
}

export function BrandName() {
  return <span className="brand-lockup">
    <span className="brand-name">{PRODUCT_NAME}</span>
    <span className="product-stage" aria-label={`${PRODUCT_STAGE} release`}>{PRODUCT_STAGE}</span>
  </span>;
}
