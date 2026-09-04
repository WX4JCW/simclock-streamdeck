import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";

const sdPlugin = "com.acms.simclock.sdPlugin";

export default {
    input: "src/plugin.ts",
    output: {
        file: `${sdPlugin}/bin/plugin.js`,
        format: "es",
        sourcemap: false,
    },
    plugins: [
        typescript({ mapRoot: null }),
        nodeResolve({ browser: false, exportConditions: ["node"], preferBuiltins: true }),
        commonjs(),
    ],
};
