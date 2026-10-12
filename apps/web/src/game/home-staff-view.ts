import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { HomeStaffRole, Vec2 } from "@lagos-living/shared";
import type { Avatar, AvatarFactory } from "./avatar";
import { equipSecurity, securityLook } from "./security-kit";

export type StaffPost = { key: string; role: HomeStaffRole; point: Vec2; yaw: number };

/** Gatemen and house guards standing at built houses; only posts near the player are drawn. */
export class HomeStaffView {
  private posted = new Map<string, Avatar>();

  constructor(
    private readonly avatars: AvatarFactory,
    private readonly ground: (x: number, z: number) => number,
    private readonly addCaster: (meshes: AbstractMesh[]) => void,
  ) {}

  update(dt: number, posts: StaffPost[]) {
    const wanted = new Set(posts.map((post) => post.key));
    for (const [key, avatar] of this.posted) {
      if (wanted.has(key)) continue;
      avatar.dispose();
      this.posted.delete(key);
    }
    for (const post of posts) {
      let avatar = this.posted.get(post.key);
      if (!avatar) {
        avatar = this.avatars.create(`home staff ${post.key}`, securityLook(post.role === "guard" ? 1 : 4));
        equipSecurity(this.avatars.scene, avatar, post.role === "guard");
        avatar.onMeshes = (meshes) => this.addCaster(meshes);
        avatar.root.position.set(post.point[0], this.ground(post.point[0], post.point[1]), post.point[1]);
        avatar.root.rotation.y = post.yaw;
        this.posted.set(post.key, avatar);
      }
      avatar.update(0, "idle", dt);
    }
  }

  dispose() {
    for (const avatar of this.posted.values()) avatar.dispose();
    this.posted.clear();
  }
}
