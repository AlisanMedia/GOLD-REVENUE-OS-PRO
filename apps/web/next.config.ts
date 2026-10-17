import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@gold-revenue-os/config", "@gold-revenue-os/contracts"],
  poweredByHeader: false,
  async headers(){return [{source:"/survey/:path*",headers:[{key:"Referrer-Policy",value:"no-referrer"},{key:"Cache-Control",value:"no-store, private"},{key:"X-Robots-Tag",value:"noindex, nofollow"},{key:"Content-Security-Policy",value:"frame-ancestors 'none'; base-uri 'self'; form-action 'self'"}]}];},
};

export default nextConfig;
