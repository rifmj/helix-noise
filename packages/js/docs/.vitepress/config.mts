import { defineConfig } from "vitepress";

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "Helix Noise",
  description:
    "Divergence-free helical flow fields, grid-free. Sample a 3-D incompressible velocity field at any point.",

  // The marketing landing (site/index.html) is served at the Pages root
  // https://<user>.github.io/helix-noise/ ; these docs live under /docs.
  base: "/helix-noise/docs/",

  cleanUrls: true,
  lastUpdated: true,

  // The API reference uses em-dash headings and cross-anchor links; don't fail the build on them.
  ignoreDeadLinks: true,

  head: [["meta", { name: "theme-color", content: "#2fd6bf" }]],

  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: "Home", link: "/" },
      { text: "JavaScript", link: "/API" },
      { text: "Python", link: "/python" },
      { text: "Rust", link: "/rust" },
      { text: "Shaders", link: "/shaders" },
      { text: "React (r3f)", link: "/r3f" },
      { text: "WebGL2 (gpu)", link: "/gpu" },
      { text: "GitHub", link: "https://github.com/rifmj/helix-noise" },
    ],

    sidebar: [
      {
        text: "Guide",
        items: [{ text: "Overview", link: "/" }],
      },
      {
        text: "JavaScript",
        items: [
          { text: "API reference", link: "/API" },
          { text: "Getting started", link: "/API#getting-started" },
          { text: "create() — spectral field", link: "/API#createoptions-the-spectral-field" },
          { text: "createAtoms() — atom field", link: "/API#createatomsoptions-the-atom-field" },
          { text: "Helpers", link: "/API#helpers" },
          { text: "Types", link: "/API#types" },
        ],
      },
      {
        text: "Other languages",
        items: [
          { text: "Python", link: "/python" },
          { text: "Rust", link: "/rust" },
          { text: "Shaders — GLSL · HLSL · WGSL · Godot", link: "/shaders" },
        ],
      },
      {
        text: "Integrations",
        items: [
          { text: "React — react-three-fiber", link: "/r3f" },
          { text: "WebGL2 particles — helix-noise-gpu", link: "/gpu" },
        ],
      },
    ],

    search: { provider: "local" },

    socialLinks: [
      { icon: "github", link: "https://github.com/rifmj/helix-noise" },
    ],

    editLink: {
      pattern: "https://github.com/rifmj/helix-noise/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },

    footer: {
      message: "Released under the MIT License.",
      copyright: "© Rifat Jumagulov",
    },
  },
});
