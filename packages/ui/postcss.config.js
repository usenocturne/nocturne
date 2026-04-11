import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";

const postcssInsetFix = () => ({
  postcssPlugin: "postcss-inset-fix",
  Declaration: {
    inset(decl) {
      const values = decl.value.split(/\s+/);
      let top, right, bottom, left;

      if (values.length === 1) {
        top = right = bottom = left = values[0];
      } else if (values.length === 2) {
        top = bottom = values[0];
        right = left = values[1];
      } else if (values.length === 3) {
        top = values[0];
        right = left = values[1];
        bottom = values[2];
      } else {
        top = values[0];
        right = values[1];
        bottom = values[2];
        left = values[3];
      }

      decl.cloneBefore({ prop: "top", value: top });
      decl.cloneBefore({ prop: "right", value: right });
      decl.cloneBefore({ prop: "bottom", value: bottom });
      decl.cloneBefore({ prop: "left", value: left });
      decl.remove();
    },
  },
});
postcssInsetFix.postcss = true;

export default {
  plugins: [tailwindcss, postcssInsetFix, autoprefixer],
};
