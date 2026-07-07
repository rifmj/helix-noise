"""mulberry32 — small, fast, deterministic 32-bit PRNG.

The integer operations here are bit-exact with the JavaScript reference
implementation (verified across languages). Do not change the wrapping
arithmetic: every intermediate is masked to uint32.
"""

_U32 = 0xFFFFFFFF


def mulberry32(seed):
    """Return a zero-argument callable yielding floats in [0, 1).

    ``seed`` is coerced to a uint32. The stream is identical to the JS
    ``mulberry32`` reference.
    """
    a = seed & _U32

    def rng():
        nonlocal a
        a = (a + 0x6D2B79F5) & _U32
        t = (a ^ (a >> 15)) & _U32
        t = (t * ((a | 1) & _U32)) & _U32
        inner = (t ^ (t >> 7)) & _U32
        inner = (inner * ((t | 61) & _U32)) & _U32
        t = (((t + inner) & _U32) ^ t) & _U32
        return ((t ^ (t >> 14)) & _U32) / 4294967296.0

    return rng
