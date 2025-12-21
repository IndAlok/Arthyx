"use client";

import { useEffect, useState } from "react";
import { motion, useMotionValue, useSpring } from "framer-motion";

export default function CursorGlow() {
  const [isVisible, setIsVisible] = useState(false);
  const [isClicking, setIsClicking] = useState(false);
  const [isHovering, setIsHovering] = useState(false);

  const cursorX = useMotionValue(-100);
  const cursorY = useMotionValue(-100);

  const springConfig = { damping: 20, stiffness: 300 };
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
        target.closest("button") ||
        target.closest("a") ||
        target.closest("[role='button']") ||
        target.closest("input")
      ) {
        setIsHovering(true);
      } else {
        setIsHovering(false);
      }
    };

    const handleMouseLeave = () => {
      setIsVisible(false);
      document.body.style.cursor = "auto";
    };

    const handleMouseEnter = () => {
      document.body.style.cursor = "none";
    };

    window.addEventListener("mousemove", moveCursor);
    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("mouseover", handleMouseOver);
    document.body.addEventListener("mouseleave", handleMouseLeave);
    document.body.addEventListener("mouseenter", handleMouseEnter);

    return () => {
      document.body.style.cursor = "auto";
      window.removeEventListener("mousemove", moveCursor);
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("mouseover", handleMouseOver);
      document.body.removeEventListener("mouseleave", handleMouseLeave);
      document.body.removeEventListener("mouseenter", handleMouseEnter);
    };
  }, [cursorX, cursorY]);

  return (
    <>
      <motion.div
        className="fixed pointer-events-none z-[9999]"
        style={{
          x: cursorXSpring,
          y: cursorYSpring,
          translateX: "-50%",
          translateY: "-50%",
        }}
        animate={{
          scale: isClicking ? 0.6 : isHovering ? 1.2 : 1,
          opacity: isVisible ? 1 : 0,
        }}
        transition={{ duration: 0.1 }}
      >
        <div className="relative">
          <div
            className={`transition-all duration-150 ${
              isHovering
                ? "w-10 h-10"
                : isClicking
                ? "w-4 h-4"
                : "w-5 h-5"
            }`}
            style={{
              background: isHovering 
                ? "radial-gradient(circle, rgba(16, 185, 129, 0.8) 0%, rgba(20, 184, 166, 0.4) 50%, transparent 70%)"
                : "radial-gradient(circle, #10b981 0%, #14b8a6 50%, transparent 70%)",
              borderRadius: isHovering ? "50%" : "0%",
              transform: isHovering ? "rotate(0deg)" : "rotate(45deg)",
            }}
          />
          
          {!isHovering && (
            <motion.div
              className="absolute top-1/2 left-1/2 w-1 h-1 bg-white rounded-full"
              style={{
                transform: "translate(-50%, -50%)",
              }}
              animate={{
                scale: isClicking ? 2 : 1,
              }}
            />
          )}
        </div>
      </motion.div>

      <motion.div
        className="fixed pointer-events-none z-[9998]"
        style={{
          x: cursorXSpring,
          y: cursorYSpring,
          translateX: "-50%",
          translateY: "-50%",
        }}
        animate={{
          scale: isClicking ? 1.8 : 1,
          opacity: isVisible ? 0.3 : 0,
        }}
        transition={{ duration: 0.2 }}
      >
        <div 
          className="w-32 h-32 rounded-full blur-2xl"
          style={{
            background: "radial-gradient(circle, rgba(16, 185, 129, 0.3) 0%, rgba(20, 184, 166, 0.1) 50%, transparent 70%)",
          }}
        />
      </motion.div>
    </>
  );
}
