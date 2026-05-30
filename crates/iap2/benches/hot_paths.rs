use bytes::{BufMut, Bytes, BytesMut};
use criterion::{black_box, criterion_group, criterion_main, BatchSize, Criterion};
use iap2_rs::{ControlBits, Iap2Command, LinkCodec, LinkPacket};
use tokio_util::codec::{Decoder, Encoder};

use iap2_rs::csm::{encode_param_block, CsmCodec, CsmFrame, CsmParam};
use iap2_rs::csm::{hid, now_playing::NowPlayingUpdate};

mod link {
    pub use iap2_rs::Iap2Command;
}

#[path = "../src/session/ea_transport.rs"]
#[allow(dead_code)]
mod ea_transport;

fn encoded_1kb_link_frame() -> Bytes {
    let payload = Bytes::from(vec![0xA5; 1024]);
    let packet = LinkPacket::with_payload(ControlBits::ACK, 7, 6, 1, payload);
    let mut codec = LinkCodec::new();
    let mut wire = BytesMut::with_capacity(1034);
    codec.encode(packet, &mut wire).unwrap();
    wire.freeze()
}

fn csm_string(id: u16, value: &str) -> CsmParam {
    let mut payload = BytesMut::with_capacity(value.len() + 1);
    payload.extend_from_slice(value.as_bytes());
    payload.put_u8(0);
    CsmParam {
        id,
        payload: payload.freeze(),
    }
}

fn csm_u8(id: u16, value: u8) -> CsmParam {
    CsmParam {
        id,
        payload: Bytes::copy_from_slice(&[value]),
    }
}

fn csm_u16(id: u16, value: u16) -> CsmParam {
    CsmParam {
        id,
        payload: Bytes::copy_from_slice(&value.to_be_bytes()),
    }
}

fn csm_u32(id: u16, value: u32) -> CsmParam {
    CsmParam {
        id,
        payload: Bytes::copy_from_slice(&value.to_be_bytes()),
    }
}

fn csm_u64(id: u16, value: u64) -> CsmParam {
    CsmParam {
        id,
        payload: Bytes::copy_from_slice(&value.to_be_bytes()),
    }
}

fn presence(id: u16) -> CsmParam {
    CsmParam {
        id,
        payload: Bytes::new(),
    }
}

fn typical_now_playing_update() -> Bytes {
    let media = encode_param_block(vec![
        csm_u64(0x00, 0x0102_0304_0506_0708),
        csm_string(0x01, "Sympathy for the Protocol - 2026 Remaster"),
        csm_u32(0x04, 243_000),
        csm_string(0x06, "Hot Path Radio: The Allocation Sessions"),
        csm_u16(0x07, 3),
        csm_u16(0x08, 12),
        csm_string(0x0C, "Nocturne Performance Ensemble"),
        csm_string(0x0E, "Nocturne"),
        presence(0x17),
        csm_u8(0x1A, 7),
    ]);
    let playback = encode_param_block(vec![
        csm_u8(0x00, 1),
        csm_u32(0x01, 42_000),
        csm_u32(0x02, 18),
        csm_u32(0x03, 84),
        csm_u8(0x05, 1),
        csm_u8(0x06, 2),
        csm_string(0x07, "Spotify"),
        csm_string(0x08, "spotify:track:0123456789abcdefghijkl"),
        csm_u16(0x0C, 100),
        presence(0x0D),
        csm_string(0x10, "com.spotify.client"),
    ]);
    CsmFrame {
        msg_id: 0x5001,
        params: vec![
            CsmParam {
                id: 0,
                payload: media,
            },
            CsmParam {
                id: 1,
                payload: playback,
            },
        ],
    }
    .into_bytes()
}

fn bench_parse_link_frame(c: &mut Criterion) {
    let wire = encoded_1kb_link_frame();
    c.bench_function("parse_1kb_iap2_frame", |b| {
        b.iter_batched(
            || BytesMut::from(&wire[..]),
            |mut input| {
                let mut codec = LinkCodec::new();
                black_box(codec.decode(&mut input).unwrap().unwrap());
            },
            BatchSize::SmallInput,
        );
    });
}

fn bench_encode_hid_report(c: &mut Criterion) {
    c.bench_function("encode_hid_button_report", |b| {
        b.iter(|| {
            let report = hid::transport_report(black_box(hid::report_bit::PLAY_PAUSE));
            let frame: CsmFrame = report.into();
            let mut codec = CsmCodec;
            let mut out = BytesMut::with_capacity(24);
            codec.encode(frame, &mut out).unwrap();
            black_box(out.freeze());
        });
    });
}

fn bench_parse_now_playing(c: &mut Criterion) {
    let update = typical_now_playing_update();
    c.bench_function("parse_typical_now_playing_update", |b| {
        b.iter_batched(
            || BytesMut::from(&update[..]),
            |mut input| {
                let mut codec = CsmCodec;
                let frame = codec.decode(&mut input).unwrap().unwrap();
                black_box(NowPlayingUpdate::try_from(frame).unwrap());
            },
            BatchSize::SmallInput,
        );
    });
}

fn bench_ea_chunker(c: &mut Criterion) {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let payload = Bytes::from(vec![0x91; 64 * 1024]);

    c.bench_function("ea_chunker_64kb_msgpack", |b| {
        b.iter(|| {
            runtime.block_on(async {
                let (link_tx, mut link_rx) = tokio::sync::mpsc::channel(128);
                let chunker = ea_transport::EaChunker::new(link_tx, 2048);
                let sender = chunker.sender(0x0100);

                sender
                    .send(ea_transport::EaPriority::Bulk, black_box(payload.clone()))
                    .await
                    .unwrap();
                drop(sender);
                drop(chunker);

                let mut frames = 0usize;
                let mut bytes = 0usize;
                while let Some(command) = link_rx.recv().await {
                    if let Iap2Command::Send { payload, .. } = command {
                        frames += 1;
                        bytes += payload.len();
                    }
                }
                black_box((frames, bytes));
            });
        });
    });
}

criterion_group!(
    benches,
    bench_parse_link_frame,
    bench_encode_hid_report,
    bench_parse_now_playing,
    bench_ea_chunker
);
criterion_main!(benches);
