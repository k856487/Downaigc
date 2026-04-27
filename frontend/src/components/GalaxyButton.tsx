import React from "react";

interface GalaxyButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  children: React.ReactNode;
  block?: boolean;
}

const GalaxyButton: React.FC<GalaxyButtonProps> = ({
  children,
  block,
  className,
  style,
  type,
  ...rest
}) => {
  return (
    <button
      type={type ?? "button"}
      className={["galaxy-btn", className].filter(Boolean).join(" ")}
      style={{ ...(block ? { width: "100%" } : null), ...style }}
      {...rest}
    >
      <span className="galaxy-btn__content">
        <span className="galaxy-btn__text">{children}</span>
      </span>
      <span className="galaxy-btn__glow" />
      <span className="galaxy-btn__stars" />
    </button>
  );
};

export default GalaxyButton;

