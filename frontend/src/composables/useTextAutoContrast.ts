import { onMounted, onBeforeUnmount, type Ref } from 'vue';

function parseRGB(color: string): [number, number, number] | null {
  const m = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!m) return null;
  return [parseInt(m[1]!), parseInt(m[2]!), parseInt(m[3]!)];
}

function lerpRGB(a: [number, number, number], b: [number, number, number], t: number): string {
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const b_ = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r},${g},${b_})`;
}

function readColors() {
  const style = getComputedStyle(document.documentElement);
  const dark = parseRGB(style.getPropertyValue('--color-primary-on-light').trim());
  const light = parseRGB(style.getPropertyValue('--color-primary-on-dark').trim());
  return { dark, light };
}

/**
 * Makes text elements inside a scroll container automatically switch between
 * dark and light color variants based on their viewport position.
 *
 * Uses the CSS custom properties --color-primary-on-light (dark variant)
 * and --color-primary-on-dark (light variant) already computed by styleStore.
 */
export function useTextAutoContrast(
  containerRef: Ref<HTMLElement | null>,
  selector: string,
) {
  let ticking = false;
  let ro: ResizeObserver | null = null;

  function update() {
    const container = containerRef.value;
    if (!container) return;

    const { dark, light } = readColors();
    if (!dark || !light) return;

    const vh = window.innerHeight;
    const elements = container.querySelectorAll<HTMLElement>(selector);

    for (const el of elements) {
      const rect = el.getBoundingClientRect();
      const t = Math.max(0, Math.min(1, rect.top / vh));
      el.style.color = lerpRGB(dark, light, t);
    }

    ticking = false;
  }

  function onScroll() {
    if (!ticking) {
      requestAnimationFrame(update);
      ticking = true;
    }
  }

  function onResize() {
    if (!ticking) {
      requestAnimationFrame(update);
      ticking = true;
    }
  }

  onMounted(() => {
    const container = containerRef.value;
    if (!container) return;

    container.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);

    ro = new ResizeObserver(() => {
      onResize();
    });
    ro.observe(container);

    update();
  });

  onBeforeUnmount(() => {
    const container = containerRef.value;
    if (container) {
      container.removeEventListener('scroll', onScroll);
    }
    window.removeEventListener('resize', onResize);
    ro?.disconnect();
    ro = null;
  });
}
