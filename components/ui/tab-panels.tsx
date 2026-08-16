"use client";

import { AnimatePresence, motion } from "motion/react";

interface TabPanelsProps {
  value: string;
  children: React.ReactNode;
  className?: string;
}

/** Crossfades content when `value` changes — pairs with <SegmentedTabs>. */
export function TabPanels({ value, children, className }: TabPanelsProps) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={value}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className={className}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
