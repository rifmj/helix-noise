import { defineConfig } from "vitepress";

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "Helix Noise",
  description:
    "Divergence-free helical flow fields, grid-free. Sample a 3-D incompressible velocity field at any point.",

  // Project site lives at https://<user>.github.io/helix-noise/
  base: "/helix-noise/",

  cleanUrls: true,
  lastUpdated: true,

  // The API reference uses em-dash headings and cross-anchor links; don't fail the build on them.
  ignoreDeadLinks: true,

  head: [["meta", { name: "theme-color", content: "#2fd6bf" }]],

  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: "Home", link: "/" },
      { text: "API Reference", link: "/API" },
      { text: "npm", link: "https://www.npmjs.com/package/helix-noise" },
    ],

    sidebar: [
      {
        text: "Guide",
        items: [{ text: "Overview", link: "/" }],
      },
      {
        text: "Reference",
        items: [
          { text: "Getting started", link: "/API#getting-started" },
          { text: "create() — spectral field", link: "/API#createoptions-the-spectral-field" },
          { text: "createAtoms() — atom field", link: "/API#createatomsoptions-the-atom-field" },
          { text: "Helpers", link: "/API#helpers" },
          { text: "Types", link: "/API#types" },
        ],
      },
    ],

    search: { provider: "local" },

    socialLinks: [
      { icon: "github", link: "https://github.com/rifatjumagulov/helix-noise" },
    ],

    editLink: {
      pattern: "https://github.com/rifatjumagulov/helix-noise/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },

    footer: {
      message: "Released under the MIT License.",
      copyright: "© Rifat Jumagulov",
    },
  },
});
