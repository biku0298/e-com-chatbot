/* eslint-disable @next/next/no-img-element -- store images are shown exactly as the API returns them, like the product cards */
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ProductDetail } from '@/lib/chat/types';
import type { ProductRef, ProductView } from './useProductDetail';
import { rupees } from './format';
import styles from './productDetail.module.css';

/** "**bold** text" → text with <strong> parts (the store marks emphasis with **). */
function richText(value: string): ReactNode {
  return value.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : <Fragment key={i}>{part}</Fragment>));
}

/** Paragraphs, with runs of "- " lines shown as one bullet list. */
function Description({ paragraphs }: { paragraphs: string[] }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) blocks.push(<ul key={blocks.length} className={styles.list}>{bullets.map((item, i) => <li key={i}>{richText(item)}</li>)}</ul>);
    bullets = [];
  };
  for (const paragraph of paragraphs) {
    const bullet = paragraph.match(/^[-•]\s+(.*)$/);
    if (bullet) bullets.push(bullet[1]);
    else {
      flush();
      blocks.push(<p key={blocks.length} className={styles.paragraph}>{richText(paragraph)}</p>);
    }
  }
  flush();
  return <>{blocks}</>;
}

function Price({ price, mrp }: { price: number; mrp: number | null }) {
  const discount = mrp && mrp > price ? Math.round(((mrp - price) / mrp) * 100) : 0;
  return (
    <div className={styles.priceRow}>
      <span className={styles.price}>{rupees(price)}</span>
      {discount > 0 && <span className={styles.mrp}>{rupees(mrp!)}</span>}
      {discount > 0 && <span className={styles.discount}>{discount}% OFF</span>}
    </div>
  );
}

function Gallery({ product }: { product: ProductDetail }) {
  const [index, setIndex] = useState(0);
  const image = product.images[index];
  if (!image) return <div className={styles.mainImage} aria-hidden />;
  return (
    <div className={styles.gallery}>
      <img src={image.url} alt={image.alt} className={styles.mainImage} />
      {product.images.length > 1 && (
        <div className={styles.thumbs}>
          {product.images.map((thumb, i) => (
            <button
              key={thumb.url}
              className={`${styles.thumb} ${i === index ? styles.thumbActive : ''}`}
              onClick={() => setIndex(i)}
              aria-label={`Show image ${i + 1} of ${product.images.length}`}
              aria-pressed={i === index}
            >
              <img src={thumb.thumbnailUrl} alt="" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Colour, size, price and Add to Cart; a chosen size shows its own price. */
function Purchase({ product, onColour, isSwitching }: { product: ProductDetail; onColour: (ref: ProductRef) => void; isSwitching: boolean }) {
  const [sizeLabel, setSizeLabel] = useState<string | null>(null);
  const [needsSize, setNeedsSize] = useState(false);
  const size = product.sizes.find(entry => entry.label === sizeLabel);

  function addToCart() {
    if (product.sizes.length && !size) {
      setNeedsSize(true);
      return;
    }
    alert(`Added "${product.name}"${size ? ` (${size.label})` : ''} to cart! 🛒`);
  }

  return (
    <>
      <Price price={size?.price ?? product.price} mrp={size ? size.mrp : product.mrp} />
      {product.colours.length > 1 && (
        <div className={styles.option}>
          <div className={styles.optionLabel}>Colour: <span>{product.colours.find(colour => colour.current)?.name}</span></div>
          <div className={styles.swatches}>
            {product.colours.map(colour => (
              <button
                key={colour.id}
                className={`${styles.swatch} ${colour.current ? styles.swatchActive : ''}`}
                onClick={() => !colour.current && onColour({ slug: colour.slug, id: colour.id })}
                disabled={isSwitching}
                aria-pressed={colour.current}
              >
                <span className={styles.swatchDot} style={{ background: colour.hex ?? '#ddd' }} />
                {colour.name}
              </button>
            ))}
          </div>
        </div>
      )}
      {product.sizes.length > 0 && (
        <div className={styles.option}>
          <div className={styles.optionLabel}>Size{size ? <>: <span>{size.label}</span></> : ''}</div>
          <div className={styles.sizes}>
            {product.sizes.map(entry => (
              <button
                key={entry.label}
                className={`${styles.size} ${entry.label === sizeLabel ? styles.sizeActive : ''}`}
                onClick={() => { setSizeLabel(entry.label); setNeedsSize(false); }}
                disabled={!entry.inStock}
                aria-pressed={entry.label === sizeLabel}
                title={entry.inStock ? undefined : 'Out of stock'}
              >
                {entry.label}
              </button>
            ))}
          </div>
          {needsSize && <div className={styles.hint} role="alert">Please pick a size first.</div>}
        </div>
      )}
      <button className={styles.cartBtn} onClick={addToCart} disabled={!product.inStock}>
        {product.inStock ? '🛒 Add to Cart' : 'Out of stock'}
      </button>
    </>
  );
}

function Details({ product }: { product: ProductDetail }) {
  return (
    <>
      {product.details.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Product details</h3>
          <dl className={styles.facts}>
            {product.details.map(fact => (
              <div key={fact.label} className={styles.fact}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {product.description.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>About this product</h3>
          <Description paragraphs={product.description} />
        </section>
      )}
      {product.keyFeatures.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Key features</h3>
          <ul className={styles.list}>{product.keyFeatures.map((feature, i) => <li key={i}>{richText(feature)}</li>)}</ul>
        </section>
      )}
      {product.careInstructions && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Care</h3>
          <p className={styles.paragraph}>{product.careInstructions}</p>
        </section>
      )}
      <div className={styles.returns}>↩️ {product.returns}</div>
    </>
  );
}

type Props = {
  view: ProductView;
  onBack: () => void;
  onOpen: (ref: ProductRef) => void;
};

/** The in-chat product popup: full details from the store, with a Back button to the conversation. */
export default function ProductDetailView({ view, onBack, onOpen }: Props) {
  const backRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const { product, preview, isLoading, error } = view;

  useEffect(() => {
    backRef.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);
  // A new colour starts at the top.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [product?.id]);

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="ray-product-title">
      <div className={styles.topBar}>
        <button ref={backRef} className={styles.backBtn} onClick={onBack}>← Back</button>
        <span className={styles.topTitle}>Product details</span>
      </div>

      <div ref={bodyRef} className={styles.body} aria-busy={isLoading}>
        {product ? (
          <div className={`${styles.layout} ${isLoading ? styles.switching : ''}`}>
            <Gallery key={product.id} product={product} />
            <div className={styles.info}>
              {product.brand && <div className={styles.brand}>{product.brand}</div>}
              <h2 id="ray-product-title" className={styles.name}>{product.name}</h2>
              {error && <div className={styles.hint} role="alert">{error}</div>}
              <Purchase key={product.id} product={product} onColour={onOpen} isSwitching={isLoading} />
              <Details product={product} />
            </div>
          </div>
        ) : (
          <div className={styles.layout}>
            {preview ? <img src={preview.imageUrl} alt={preview.name} className={styles.mainImage} /> : <div className={styles.mainImage} aria-hidden />}
            <div className={styles.info}>
              {preview?.brand && <div className={styles.brand}>{preview.brand}</div>}
              <h2 id="ray-product-title" className={styles.name}>{preview?.name ?? 'Product'}</h2>
              {preview && <Price price={preview.price} mrp={preview.mrp ?? null} />}
              {error ? (
                <div className={styles.errorBox} role="alert">
                  <p>{error}</p>
                  <button className={styles.cartBtn} onClick={() => onOpen(view.ref)}>Try again</button>
                </div>
              ) : (
                <div className={styles.loading}>
                  <span className={styles.dot} /><span className={styles.dot} /><span className={styles.dot} />
                  Loading details…
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
