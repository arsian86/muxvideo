const { EntitySchema } = require("typeorm");

// 課程影片表：儲存每一堂課的影片資訊
module.exports = new EntitySchema({
  name: "Course_Video",
  tableName: "course_video",
  columns: {
    mux_asset_id: {
      primary: true,
      type: "varchar",
    },
    mux_playback_id: {
      type: "varchar",
      length: 64,
      nullable: false,
    },
    chapter_id: {
      type: "uuid",
      nullable: false,
    },
    duration: {
      type: "float",
      nullable: true,
    },
    status: {
      type: "varchar",
      length: 32,
      default: "waiting",
    },
    // position: {
    //   type: "int",
    //   default: 1,
    // },
    created_at: {
      type: "timestamp",
      createDate: true,
    },
  },
  relations: {
    CourseChapter: {
      target: "Course_Chapter",
      type: "many-to-one",
      joinColumn: {
        name: "chapter_id", //本表的欄位
        referencedColumnName: "id", //對方表的主鍵名稱
        foreignKeyConstraintName: "fk_video_chapter_id",
      },
      onDelete: "CASCADE",
    },
    ViewStat: {
      target: "View_Stat",
      type: "one-to-many",
      inverseSide: "Course_Video",
    },
  },
});
