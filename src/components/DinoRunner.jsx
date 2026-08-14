import React, { useCallback, useEffect, useRef, useState } from "react";

const INTERACTIVE_SELECTOR =
  "button, input, textarea, select, option, label, a, [role='button'], [contenteditable='true']";

export default function DinoRunner({ active }) {
  const [jumping, setJumping] = useState(false);
  const [hit, setHit] = useState(false);
  const [round, setRound] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const dinoRef = useRef(null);
  const obstacleRef = useRef(null);
  const resetTimerRef = useRef(null);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  const jump = useCallback(() => {
    if (!active || reduceMotion || jumping || hit) return;
    setJumping(true);
  }, [active, hit, jumping, reduceMotion]);

  useEffect(() => {
    if (!active || reduceMotion) return undefined;

    const handleKeyDown = (event) => {
      if (event.code !== "Space" || event.repeat) return;
      if (event.target instanceof Element && event.target.matches(
        "input, textarea, select, [contenteditable='true']"
      )) return;
      event.preventDefault();
      jump();
    };

    const handlePointerDown = (event) => {
      if (
        event.target instanceof Element &&
        event.target.closest(INTERACTIVE_SELECTOR)
      ) return;
      jump();
    };

    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [active, jump, reduceMotion]);

  useEffect(() => {
    if (!active || reduceMotion || hit) return undefined;

    const collisionTimer = window.setInterval(() => {
      const dino = dinoRef.current?.getBoundingClientRect();
      const obstacle = obstacleRef.current?.getBoundingClientRect();
      if (!dino || !obstacle) return;

      const overlaps =
        dino.right - 5 > obstacle.left &&
        dino.left + 5 < obstacle.right &&
        dino.bottom - 3 > obstacle.top &&
        dino.top + 3 < obstacle.bottom;

      if (!overlaps) return;
      setHit(true);
      setJumping(false);
      resetTimerRef.current = window.setTimeout(() => {
        setRound((value) => value + 1);
        setHit(false);
      }, 520);
    }, 45);

    return () => window.clearInterval(collisionTimer);
  }, [active, hit, reduceMotion, round]);

  useEffect(
    () => () => {
      if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
    },
    []
  );

  if (!active) return null;

  return (
    <div
      className={`dino-runner${hit ? " is-hit" : ""}${
        reduceMotion ? " is-static" : ""
      }`}
      aria-label={
        reduceMotion
          ? "正在生成岗位卡片"
          : "生成等待小游戏，点击页面空白处或按空格让小恐龙跳跃"
      }
    >
      <span className="dino-runner__hint" aria-hidden="true">
        {reduceMotion ? "正在生成" : "点击空白处或按空格跳跃"}
      </span>
      <div
        ref={dinoRef}
        className={`dino-runner__dino${jumping ? " is-jumping" : ""}`}
        onAnimationEnd={(event) => {
          if (event.animationName === "dino-jump") setJumping(false);
        }}
        aria-hidden="true"
      />
      <div
        key={round}
        ref={obstacleRef}
        className="dino-runner__obstacle"
        aria-hidden="true"
      >
        <i />
      </div>
    </div>
  );
}
