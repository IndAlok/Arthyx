"use client";

import { useEffect, useState } from "react";
import { motion, useMotionValue, useSpring } from "framer-motion";

export default function CursorGlow() {
  const [isVisible, setIsVisible] = useState(false);
  const [isClicking, setIsClicking] = useState(false);
  const [isHovering, setIsHovering] = useState(false);

  const cursorX = useMotionValue(-100);
  const cursorY = useMotionValue(-100);

  const springConfig = { damping: 25, stiffness: 400 };
  const cursorXSpring = useSpring(cursorX, springConfig);
  const cursorYSpring = useSpring(cursorY, springConfig);

  useEffect(() => {
    document.body.style.cursor = "none";

    const moveCursor = (e: MouseEvent) => {
      cursorX.set(e.clientX);
      cursorY.set(e.clientY);
      setIsVisible(true);
    };

    const handleMouseDown = () => setIsClicking(true);
    const handleMouseUp = () => setIsClicking(false);

    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "BUTTON" ||
        target.tagName === "A" ||
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.closest("button") ||
        target.closest("a") ||
        target.closest("[role='button']") ||
        target.closest("input") ||
        target.closest("textarea")
      ) {
        setIsHovering(true);
      } else {
        setIsHovering(false);
      }
    };

    const handleMouseLeave = () => {
      setIsVisible(false);
    };

    window.addEventListener("mousemove", moveCursor);
    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("mouseover", handleMouseOver);
    document.body.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      document.body.style.cursor = "auto";
      window.removeEventListener("mousemove", moveCursor);
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("mouseover", handleMouseOver);
      document.body.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [cursorX, cursorY]);

  return (
    <>
      <motion.div
        className="fixed pointer-events-none z-[9999]"
        style={{
          x: cursorXSpring,
          y: cursorYSpring,
        }}
        animate={{
          scale: isClicking ? 0.8 : isHovering ? 1.3 : 1,
          opacity: isVisible ? 1 : 0,
        }}
        transition={{ duration: 0.1 }}
      >
        <svg
          width="28"
          height="28"
          viewBox="0 0 28 28"
          fill="none"
          style={{
            marginLeft: "-2px",
            marginTop: "-2px",
            filter: isHovering ? "drop-shadow(0 0 8px rgba(16, 185, 129, 0.6))" : "drop-shadow(0 2px 4px rgba(0,0,0,0.3))",
          }}
        >
          <path
            d="M4 4L12 24L15 15L24 12L4 4Z"
            fill={isHovering ? "#10b981" : "white"}
            stroke={isHovering ? "#059669" : "#1e293b"}
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path
            d="M14.5 14.5L22 22"
            stroke={isHovering ? "#10b981" : "#1e293b"}
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </motion.div>

      <motion.div
        className="fixed pointer-events-none z-[9998] rounded-full"
        style={{
          x: cursorXSpring,
          y: cursorYSpring,
          translateX: "-50%",
          translateY: "-50%",
          marginLeft: "10px",
          marginTop: "10px",
        }}
        animate={{
          width: isClicking ? 40 : isHovering ? 50 : 30,
          height: isClicking ? 40 : isHovering ? 50 : 30,
          opacity: isVisible ? (isHovering ? 0.4 : 0.2) : 0,
        }}
        transition={{ duration: 0.2 }}
      >
        <div 
          className="w-full h-full rounded-full"
          style={{
            background: "radial-gradient(circle, rgba(16, 185, 129, 0.4) 0%, transparent 70%)",
          }}
        />
      </motion.div>
    </>
  );
}
