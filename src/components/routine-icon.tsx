import {
  Bath,
  Bike,
  BookOpen,
  CookingPot,
  Dumbbell,
  Footprints,
  Moon,
  Shirt,
  ShoppingBasket,
  ShowerHead,
  Sparkles,
  Sprout,
  WashingMachine,
  type LucideIcon,
} from "lucide-react";

import type { RoutineIcon as RoutineIconId } from "@/lib/types";

const ICONS: Record<RoutineIconId, { icon: LucideIcon; label: string }> = {
  "shower-head": { icon: ShowerHead, label: "Shower" },
  bath: { icon: Bath, label: "Bath" },
  "washing-machine": { icon: WashingMachine, label: "Laundry" },
  shirt: { icon: Shirt, label: "Clothes" },
  dumbbell: { icon: Dumbbell, label: "Workout" },
  footprints: { icon: Footprints, label: "Walk" },
  bike: { icon: Bike, label: "Ride" },
  "shopping-basket": { icon: ShoppingBasket, label: "Groceries" },
  "cooking-pot": { icon: CookingPot, label: "Cooking" },
  sprout: { icon: Sprout, label: "Plants" },
  sparkles: { icon: Sparkles, label: "Cleaning" },
  moon: { icon: Moon, label: "Sleep" },
  "book-open": { icon: BookOpen, label: "Reading" },
};

export function routineIconLabel(icon: RoutineIconId) {
  return ICONS[icon]?.label ?? "Routine";
}

export function RoutineIcon({
  icon,
  size = 18,
  className,
}: {
  icon: RoutineIconId;
  size?: number;
  className?: string;
}) {
  const Icon = ICONS[icon]?.icon ?? Sparkles;
  return <Icon className={className} size={size} strokeWidth={1.8} aria-hidden="true" />;
}
