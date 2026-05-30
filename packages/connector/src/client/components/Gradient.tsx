import { clsx } from "clsx";

interface GradientProps extends React.ComponentPropsWithoutRef<"div"> {
  colors?: string[];
}

export function Gradient({
  className,
  colors,
  ...props
}: GradientProps) {
  const c = colors && colors.length >= 3 ? colors : ["#1a132e", "#0c0c0c", "#0a0a0a"];

  return (
    <div
      {...props}
      className={clsx(className, "transition-all duration-2000 ease-in-out")}
      style={{
        background: `linear-gradient(115deg, ${c[0]} 28%, ${c[1]} 70%, ${c[2]} 100%)`,
        ...props.style,
      }}
    />
  );
}
