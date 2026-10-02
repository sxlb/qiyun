"use client";

import { useEffect, useRef, useState } from "react";

type EffectType = "firefly" | "snow" | "lantern";

interface SeasonalEffectProps {
  type: EffectType;
  enabled: boolean;
}

// ===== 萤火虫特效 =====
function FireflyCanvas({ canvasRef }: { canvasRef: React.RefObject<HTMLCanvasElement | null> }) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    let particles: { x: number; y: number; opacity: number; speedX: number; speedY: number; radius: number }[] = [];

    // DPR 上限 2：避免 Retina 屏 canvas 物理分辨率过高导致 fill 开销翻倍
    const resizeCanvas = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const createParticles = () => {
      particles = [];
      // 粒子数按视口面积缩放，并限制移动端上限（面积 ≈ 宽×高）
      const area = window.innerWidth * window.innerHeight;
      const max = window.innerWidth < 768 ? 24 : 48;
      const count = Math.max(12, Math.min(max, Math.round(area / 40000)));
      for (let i = 0; i < count; i++) {
        particles.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          opacity: Math.random(),
          speedX: Math.random() * 1.2 - 0.35,
          speedY: Math.random() * 1.2 - 0.35,
          radius: Math.random() * 2 + 1,
        });
      }
    };

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "rgba(255, 255, 0, 0.8)";
      ctx.beginPath();
      particles.forEach((p) => {
        ctx.moveTo(p.x, p.y);
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2, true);
      });
      ctx.fill();

      particles.forEach((p) => {
        p.x += p.speedX;
        p.y += p.speedY;
        if (p.x > canvas.width || p.x < 0) p.speedX *= -1;
        if (p.y > canvas.height || p.y < 0) p.speedY *= -1;
      });

      animationFrameId = requestAnimationFrame(animate);
    };

    // resize 节流：使用 requestIdleCallback
    let resizeTimer: number | undefined;
    const debouncedResize = () => {
      if (resizeTimer) cancelAnimationFrame(resizeTimer);
      resizeTimer = requestAnimationFrame(() => {
        resizeCanvas();
        createParticles();
        resizeTimer = undefined;
      });
    };

    resizeCanvas();
    createParticles();
    animate();

    window.addEventListener("resize", debouncedResize);
    // 页面隐藏时暂停动画，可见时恢复（省电/降低后台开销）
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(animationFrameId);
      } else {
        animationFrameId = requestAnimationFrame(animate);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(animationFrameId);
      if (resizeTimer) cancelAnimationFrame(resizeTimer);
      window.removeEventListener("resize", debouncedResize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [canvasRef]);

  return (
    <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none" style={{ zIndex: 0 }} />
  );
}

// ===== 雪花特效（合并路径 + resize 节流） =====
function SnowCanvas({ canvasRef }: { canvasRef: React.RefObject<HTMLCanvasElement | null> }) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    let snowflakes: { x: number; y: number; opacity: number; speedX: number; speedY: number; radius: number; angle: number }[] = [];

    // DPR 上限 2：避免 Retina 屏 canvas 物理分辨率过高导致 fill 开销翻倍
    const resizeCanvas = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const createSnowflakes = () => {
      snowflakes = [];
      // 粒子数按视口面积缩放，并限制移动端上限
      const area = window.innerWidth * window.innerHeight;
      const max = window.innerWidth < 768 ? 28 : 60;
      const count = Math.max(14, Math.min(max, Math.round(area / 34000)));
      for (let i = 0; i < count; i++) {
        snowflakes.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          opacity: Math.random() * 0.3 + 0.2,
          speedX: Math.random() * 0.3 + 0.2,
          speedY: Math.random() * 1.2 + 0.3,
          radius: Math.random() * 2 + 1,
          angle: Math.random() * Math.PI * 2,
        });
      }
    };

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // ✅ 优化：将所有雪花合并到同一个 beginPath / fill 中，减少 draw call
      ctx.beginPath();
      snowflakes.forEach((flake) => {
        ctx.globalAlpha = flake.opacity;
        ctx.fillStyle = "white";
        ctx.moveTo(flake.x, flake.y);
        ctx.arc(flake.x, flake.y, flake.radius, 0, Math.PI * 2);
      });
      ctx.fill();
      ctx.globalAlpha = 1;

      for (const flake of snowflakes) {
        flake.angle += 0.02;
        flake.x += flake.speedX + Math.sin(flake.angle) * 0.3;
        flake.y += flake.speedY;

        if (flake.y > canvas.height || flake.x > canvas.width + 50 || flake.x < -50) {
          flake.x = Math.random() * canvas.width;
          flake.y = -flake.radius;
          flake.speedX = Math.random() * 0.6 + 0.2;
          flake.speedY = Math.random() * 1.5 + 0.5;
          flake.radius = Math.random() * 2 + 1;
          flake.opacity = Math.random() * 0.7 + 0.3;
          flake.angle = Math.random() * Math.PI * 2;
        }
      }

      animationFrameId = requestAnimationFrame(animate);
    };

    // ✅ resize 节流
    let resizeTimer: number | undefined;
    const debouncedResize = () => {
      if (resizeTimer) cancelAnimationFrame(resizeTimer);
      resizeTimer = requestAnimationFrame(() => {
        resizeCanvas();
        createSnowflakes();
        resizeTimer = undefined;
      });
    };

    resizeCanvas();
    createSnowflakes();
    animate();

    window.addEventListener("resize", debouncedResize);
    // 页面隐藏时暂停动画，可见时恢复（省电/降低后台开销）
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(animationFrameId);
      } else {
        animationFrameId = requestAnimationFrame(animate);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(animationFrameId);
      if (resizeTimer) cancelAnimationFrame(resizeTimer);
      window.removeEventListener("resize", debouncedResize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [canvasRef]);

  return (
    <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none" style={{ zIndex: 0 }} />
  );
}

// ===== 灯笼特效（CSS 动画） =====
function LanternEffect() {
  const [isMobile, setIsMobile] = useState(false);

  // ✅ resize 节流
  useEffect(() => {
    let timer: number;
    const checkMobile = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setIsMobile(window.innerWidth < 520), 150) as unknown as number;
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", checkMobile);
    };
  }, []);

  if (isMobile) return null;

  return (
    <>
      <style>{`
        .lantern-wrapper {
          position: fixed;
          top: 12px;
          pointer-events: none;
          user-select: none;
          z-index: 999;
          will-change: transform;
        }
        .lantern-wrapper:first-of-type { left: 40px; }
        .lantern-wrapper:last-of-type { right: 40px; }
        .lantern-box {
          position: relative;
          display: inline-block;
          width: 90px;
          height: 70px;
          background: rgba(216, 0, 15, 0.8);
          border-radius: 50% 50%;
          animation: lantern-swing 3s ease-in-out infinite alternate-reverse;
          transform-origin: 50% -70px;
          box-shadow: -5px 5px 50px 4px #fa6c00;
          will-change: transform;
        }
        .lantern-box.secondary { animation-delay: 1s; }
        .lantern-box::after, .lantern-box::before {
          content: "";
          position: absolute;
          height: 8px;
          width: 45px;
          left: 50%;
          border: 1px solid #dc8f03;
          background: linear-gradient(90deg, #dc8f03, orange, #dc8f03, orange, #dc8f03);
        }
        .lantern-box::before { top: 0; border-radius: 5px 5px 0 0; transform: translate(-50%, -50%); }
        .lantern-box::after { bottom: 0; border-radius: 0 0 5px 5px; transform: translate(-50%, 50%); }
        .lantern-line {
          position: absolute;
          width: 2px;
          height: 12px;
          top: 0;
          left: 50%;
          transform: translate(-50%, -100%);
          background: #dc8f03;
        }
        .lantern-circle {
          width: 80%;
          box-sizing: border-box;
          height: 100%;
          margin: 0 auto;
          border-radius: 50%;
          border: 2px solid #dc8f03;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .lantern-text {
          font-family: "Microsoft YaHei", sans-serif;
          font-size: 24px;
          color: #dc8f03;
          font-weight: 700;
        }
        .lantern-tail {
          position: relative;
          width: 4px;
          height: 12px;
          margin: 0 auto;
          animation: lantern-swing 4s ease-in-out infinite alternate-reverse;
          background: orange;
          border-radius: 0 0 5px 5px;
        }
        .lantern-tail-junction {
          position: absolute;
          top: 0;
          left: 50%;
          width: 8px;
          height: 8px;
          transform: translate(-50%, 8.4px);
          background: #e69603;
          border-radius: 50%;
        }
        .lantern-tail-rect {
          position: absolute;
          top: 0;
          left: 50%;
          transform: translate(-50%, 10.8px);
          width: 8px;
          height: 24px;
          background: orange;
          border-radius: 5px 5px 0 5px;
        }
        @keyframes lantern-swing {
          0% { transform: rotate(-8deg); }
          to { transform: rotate(8deg); }
        }
      `}</style>

      {/* 左灯笼 */}
      <div className="lantern-wrapper">
        <div className="lantern-box">
          <div className="lantern-line"></div>
          <div className="lantern-circle"><div className="lantern-text">新</div></div>
          <div className="lantern-tail">
            <div className="lantern-tail-junction"></div>
            <div className="lantern-tail-rect"></div>
          </div>
        </div>
      </div>

      {/* 右灯笼 */}
      <div className="lantern-wrapper">
        <div className="lantern-box secondary">
          <div className="lantern-line"></div>
          <div className="lantern-circle"><div className="lantern-text">年</div></div>
          <div className="lantern-tail">
            <div className="lantern-tail-junction"></div>
            <div className="lantern-tail-rect"></div>
          </div>
        </div>
      </div>
    </>
  );
}

export default function SeasonalEffect({ type, enabled }: SeasonalEffectProps) {
  const fireflyRef = useRef<HTMLCanvasElement>(null);
  const snowRef = useRef<HTMLCanvasElement>(null);

  if (!enabled) return null;

  return (
    <>
      {type === "firefly" && <FireflyCanvas canvasRef={fireflyRef} />}
      {type === "snow" && <SnowCanvas canvasRef={snowRef} />}
      {type === "lantern" && <LanternEffect />}
    </>
  );
}
