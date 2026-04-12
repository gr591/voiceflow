fn main() {
    // Tauri fails the build if a resource glob matches nothing.
    // The subdirectories under binaries/ are populated by the download scripts
    // and CI — they may be empty during a fresh build.
    // We tell cargo to re-run this script when those dirs change so that a
    // later `cargo build` after downloading binaries picks them up.
    println!("cargo:rerun-if-changed=binaries/espeak-ng-data");
    println!("cargo:rerun-if-changed=binaries/voices");
    println!("cargo:rerun-if-changed=binaries/llama");
    println!("cargo:rerun-if-changed=binaries/models");

    tauri_build::build()
}
