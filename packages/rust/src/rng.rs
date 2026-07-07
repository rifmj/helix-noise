//! `mulberry32` — a small, fast, deterministic PRNG seeded by a 32-bit integer.
//!
//! This is a faithful, bit-exact port of the JavaScript reference implementation. The
//! integer stream is identical across languages; only the final division to `f64` is a
//! plain IEEE-754 operation. Get the draw order right and the whole field is reproducible.

/// A `mulberry32` generator. Call [`Mulberry32::next_f64`] to draw the next uniform in `[0, 1)`.
#[derive(Clone, Debug)]
pub struct Mulberry32 {
    a: u32,
}

impl Mulberry32 {
    /// Create a generator from a raw 32-bit seed.
    ///
    /// Note: the field builder applies the JS convention `(seed >>> 0) || 1`, i.e. a zero
    /// seed becomes `1`. Use [`Mulberry32::seeded`] to reproduce that behaviour.
    #[inline]
    pub fn new(seed: u32) -> Self {
        Self { a: seed }
    }

    /// Create a generator applying the reference seed convention: a `0` seed maps to `1`.
    #[inline]
    pub fn seeded(seed: u32) -> Self {
        Self { a: if seed == 0 { 1 } else { seed } }
    }

    /// Draw the next uniform sample in `[0, 1)`.
    #[inline]
    pub fn next_f64(&mut self) -> f64 {
        self.a = self.a.wrapping_add(0x6d2b_79f5);
        let mut t = (self.a ^ (self.a >> 15)).wrapping_mul(self.a | 1);
        t = (t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61))) ^ t;
        ((t ^ (t >> 14)) as f64) / 4_294_967_296.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_draws_match_reference() {
        // Values produced by the JS/Python reference for seed = 1.
        let mut r = Mulberry32::seeded(1);
        let expected = [
            0.6270739405881613,
            0.002735721180215478,
            0.5274470399599522,
        ];
        for &e in &expected {
            let got = r.next_f64();
            assert!((got - e).abs() < 1e-15, "got {got}, expected {e}");
        }
    }

    #[test]
    fn zero_seed_maps_to_one() {
        let mut a = Mulberry32::seeded(0);
        let mut b = Mulberry32::seeded(1);
        assert_eq!(a.next_f64(), b.next_f64());
    }
}
