declare module 'unishox2.siara.cc' {
  const pkg: {
    unishox2_compress_simple(input: string, length: number, out: Uint8Array): number;
    unishox2_decompress_simple(input: Uint8Array, length: number): string;
  };
  export default pkg;
}
