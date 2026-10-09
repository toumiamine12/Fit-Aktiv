"use client";;
import { cn } from "@/lib/utils";
import {
  useReducedMotion,
  useScroll,
  useTransform,
  motion,
} from "framer-motion";
import { useRef } from "react";

const DEFAULT_CARDS = [
  {
    title: "Misty Alps",
    src: "https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=1200&q=85",
  },
  {
    title: "Sunlit Grove",
    src: "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=1200&q=85",
  },
  {
    title: "Turquoise Shore",
    src: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1200&q=85",
  },
  {
    title: "Mountain Pass",
    src: "https://images.unsplash.com/photo-1482938289607-e9573fc25ebb?w=1200&q=85",
  },
  {
    title: "Rolling Hills",
    src: "https://images.unsplash.com/photo-1501854140801-50d01698950b?w=1200&q=85",
  },
];

const TILT_PATTERN = [-1.25, 0.85, -0.65, 1.35, -0.9];

function StackCard({
  card,
  index,
  total,
  container,
  reduceMotion
}) {
  const { scrollYProgress } = useScroll({
    target: container,
    offset: ["start start", "end end"],
  });
  const start = total > 1 ? index / (total + 1) : 0;
  const restingScale = Math.max(0.56, 1 - (total - index - 1) * 0.095);
  const scale = useTransform(
    scrollYProgress,
    [start, 1],
    reduceMotion ? [1, 1] : [1, restingScale],
  );

  return (
    <section className="sticky top-0 grid h-[80vh] place-items-center">
      <motion.figure
        className="relative m-0 origin-top overflow-hidden rounded bg-white text-neutral-950"
        style={{
          scale,
          rotate: reduceMotion ? 0 : TILT_PATTERN[index % TILT_PATTERN.length],
          top: `calc(-14vh + ${100 + index * 22}px)`,
          boxShadow:
            "0 2px 5px rgb(0 0 0 / 0.06), 0 18px 48px rgb(0 0 0 / 0.13)",
        }}
      >
        <div className="p-2.5 pb-0">
          <img
            src={card.src}
            alt={card.title}
            className="block h-[clamp(210px,32vw,290px)] w-[min(78vw,460px)] object-cover"
            loading={index < 2 ? "eager" : "lazy"}
            draggable={false}
          />
        </div>
        <figcaption className="grid w-[min(78vw,460px)] gap-1 px-4 pb-4 pt-3">
          <strong className="text-xl font-extrabold tracking-tight font-stretch-expanded">
            {card.title}
          </strong>
          {card.description && (
            <span className="text-sm text-neutral-600">{card.description}</span>
          )}
        </figcaption>
      </motion.figure>
    </section>
  );
}

export function StickyScrollCards({
  cards = DEFAULT_CARDS,
  hint,
  className
}) {
  const container = useRef(null);
  const reduceMotion = useReducedMotion() ?? false;

  return (
    <div
      ref={container}
      className={cn(
        "relative flex w-full flex-col items-center pb-[30vh]",
        className,
      )}
    >
      {hint && (
        <div className="absolute left-1/2 top-0 flex -translate-x-1/2 flex-col items-center gap-3">
          <p className="text-xs font-medium opacity-50">{hint}</p>
          <span className="h-12 w-px bg-gradient-to-b from-foreground/30 to-transparent" />
        </div>
      )}

      {cards.map((card, index) => (
        <StackCard
          key={`${card.src}-${index}`}
          card={card}
          index={index}
          total={cards.length}
          container={container}
          reduceMotion={reduceMotion}
        />
      ))}
    </div>
  );
}
