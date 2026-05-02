-- CreateTable
CREATE TABLE "products" (
    "code" VARCHAR(20) NOT NULL,
    "jan" VARCHAR(13),
    "name" VARCHAR(100) NOT NULL,
    "cat" VARCHAR(20) NOT NULL,
    "pkg" VARCHAR(20) NOT NULL DEFAULT '箱',
    "price" INTEGER NOT NULL DEFAULT 0,
    "lead_days" INTEGER NOT NULL DEFAULT 0,
    "std_sec" INTEGER NOT NULL DEFAULT 0,
    "frozen" BOOLEAN NOT NULL DEFAULT false,
    "special" BOOLEAN NOT NULL DEFAULT false,
    "noshi" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "product_aux_attrs" (
    "id" SERIAL NOT NULL,
    "product_code" VARCHAR(20) NOT NULL,
    "disp_name" VARCHAR(100),
    "temp_zone" VARCHAR(10) NOT NULL DEFAULT 'ambient',
    "special_pkg" VARCHAR(30),
    "std_sec" INTEGER NOT NULL DEFAULT 0,
    "transferred" BOOLEAN NOT NULL DEFAULT false,
    "w_mm" INTEGER NOT NULL DEFAULT 0,
    "d_mm" INTEGER NOT NULL DEFAULT 0,
    "h_mm" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "product_aux_attrs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "set_comps" (
    "id" VARCHAR(30) NOT NULL,
    "parent_code" VARCHAR(20) NOT NULL,
    "parent_name" VARCHAR(100) NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "fixed_box_code" VARCHAR(30),
    "packing_note" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "set_comps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "set_comp_children" (
    "id" SERIAL NOT NULL,
    "set_comp_id" VARCHAR(30) NOT NULL,
    "child_code" VARCHAR(20) NOT NULL,
    "child_name" VARCHAR(100),
    "qty" INTEGER NOT NULL DEFAULT 1,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "set_comp_children_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boxes" (
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "size_rank" INTEGER NOT NULL,
    "w_mm" INTEGER NOT NULL DEFAULT 0,
    "d_mm" INTEGER NOT NULL DEFAULT 0,
    "h_mm" INTEGER NOT NULL DEFAULT 0,
    "inner_w_mm" INTEGER NOT NULL DEFAULT 0,
    "inner_d_mm" INTEGER NOT NULL DEFAULT 0,
    "inner_h_mm" INTEGER NOT NULL DEFAULT 0,
    "frozen" BOOLEAN NOT NULL DEFAULT false,
    "noshi" BOOLEAN NOT NULL DEFAULT false,
    "target_products" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "priority" INTEGER NOT NULL DEFAULT 50,
    "note" TEXT,

    CONSTRAINT "boxes_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "carriers" (
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "short" VARCHAR(20),
    "priority" INTEGER NOT NULL DEFAULT 99,
    "cutoff" VARCHAR(5),
    "pickup" VARCHAR(5),
    "cool" BOOLEAN NOT NULL DEFAULT false,
    "wb_type" VARCHAR(30),
    "contact" VARCHAR(100),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,

    CONSTRAINT "carriers_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "staff" (
    "code" VARCHAR(10) NOT NULL,
    "emp_code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(30) NOT NULL,
    "kana" VARCHAR(40),
    "role" VARCHAR(20) NOT NULL DEFAULT 'staff',
    "employment_type_code" VARCHAR(20),
    "group_id" VARCHAR(10),
    "default_shift_pattern" VARCHAR(10),
    "tel" VARCHAR(20),
    "joined" DATE,
    "assignable" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,

    CONSTRAINT "staff_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "devices" (
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "model" VARCHAR(50),
    "location" VARCHAR(50),
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "inspection_groups" (
    "id" VARCHAR(10) NOT NULL,
    "name" VARCHAR(20) NOT NULL,
    "tables" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "category" VARCHAR(20) NOT NULL,
    "need_staff" INTEGER NOT NULL DEFAULT 1,
    "note" TEXT,

    CONSTRAINT "inspection_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "std_times" (
    "code" VARCHAR(20) NOT NULL,
    "group_id" VARCHAR(10) NOT NULL,
    "table_id" VARCHAR(5) NOT NULL,
    "std_min" DECIMAL(5,2) NOT NULL DEFAULT 2.00,
    "source" VARCHAR(10) NOT NULL DEFAULT 'manual',
    "updated_at" DATE NOT NULL,
    "note" TEXT,

    CONSTRAINT "std_times_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "shift_patterns" (
    "code" VARCHAR(10) NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "start_time" VARCHAR(5),
    "end_time" VARCHAR(5),
    "break_min" INTEGER NOT NULL DEFAULT 0,
    "is_off" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "shift_patterns_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "employment_types" (
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "daily_hours" DECIMAL(4,2) NOT NULL DEFAULT 8.00,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "employment_types_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "staff_code" VARCHAR(10) NOT NULL,
    "pattern_code" VARCHAR(10) NOT NULL,
    "start_time" VARCHAR(5),
    "end_time" VARCHAR(5),
    "source" VARCHAR(10) NOT NULL DEFAULT 'manual',
    "imported_at" TIMESTAMPTZ,
    "note" TEXT,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "printers" (
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "ip_address" VARCHAR(15) NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 9100,
    "model" VARCHAR(50) NOT NULL DEFAULT 'SCeaTa CT4-LX',
    "location" VARCHAR(50),
    "label_size" VARCHAR(20) NOT NULL DEFAULT '30x40',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,

    CONSTRAINT "printers_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "device_printer_map" (
    "id" SERIAL NOT NULL,
    "device_code" VARCHAR(20) NOT NULL,
    "printer_code" VARCHAR(20) NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" VARCHAR(10),

    CONSTRAINT "device_printer_map_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notices" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "title" VARCHAR(100) NOT NULL,
    "body" TEXT,
    "target_type" VARCHAR(10) NOT NULL DEFAULT 'all',
    "target_id" VARCHAR(20),
    "priority" INTEGER NOT NULL DEFAULT 50,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_orders" (
    "id" UUID NOT NULL,
    "pk_no" VARCHAR(30) NOT NULL,
    "import_id" INTEGER,
    "ship_date" DATE NOT NULL,
    "carrier_code" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "qr_print_flag" BOOLEAN NOT NULL DEFAULT false,
    "noshi_name" VARCHAR(50),
    "dest_zip" VARCHAR(8),
    "dest_addr" VARCHAR(200),
    "dest_name" VARCHAR(100),
    "invoice_no" VARCHAR(30),
    "hold_reason" TEXT,
    "deleted_at" TIMESTAMPTZ,
    "deleted_by" VARCHAR(10),
    "delete_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "shipping_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_order_items" (
    "id" SERIAL NOT NULL,
    "order_id" UUID NOT NULL,
    "product_code" VARCHAR(20) NOT NULL,
    "product_name" VARCHAR(100) NOT NULL,
    "qty" INTEGER NOT NULL,
    "scanned_qty" INTEGER NOT NULL DEFAULT 0,
    "force_ok" BOOLEAN NOT NULL DEFAULT false,
    "force_reason" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "shipping_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insp_sessions" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "staff_code" VARCHAR(10) NOT NULL,
    "device_code" VARCHAR(20),
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,
    "box_code" VARCHAR(30),
    "force_ok_count" INTEGER NOT NULL DEFAULT 0,
    "duration_sec" INTEGER,

    CONSTRAINT "insp_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insp_logs" (
    "id" SERIAL NOT NULL,
    "session_id" UUID NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "item_code" VARCHAR(20),
    "qty" INTEGER,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insp_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "thomas_imports" (
    "id" SERIAL NOT NULL,
    "filename" VARCHAR(200) NOT NULL,
    "file_type" VARCHAR(20) NOT NULL,
    "imported_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "jan_error_count" INTEGER NOT NULL DEFAULT 0,
    "unmap_count" INTEGER NOT NULL DEFAULT 0,
    "imported_by" VARCHAR(10),
    "note" TEXT,

    CONSTRAINT "thomas_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" SERIAL NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "severity" VARCHAR(10) NOT NULL DEFAULT 'warn',
    "title" VARCHAR(100) NOT NULL,
    "body" TEXT,
    "ref_code" VARCHAR(50),
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMPTZ,
    "resolved_by" VARCHAR(10),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_assignments" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "staff_code" VARCHAR(10) NOT NULL,
    "group_id" VARCHAR(10) NOT NULL,
    "start_time" VARCHAR(5) NOT NULL,
    "end_time" VARCHAR(5) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "created_by" VARCHAR(10),

    CONSTRAINT "member_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "print_logs" (
    "id" SERIAL NOT NULL,
    "order_id" UUID NOT NULL,
    "pk_no" VARCHAR(30) NOT NULL,
    "invoice_no" VARCHAR(30),
    "printer_code" VARCHAR(20) NOT NULL,
    "device_code" VARCHAR(20),
    "staff_code" VARCHAR(10),
    "printed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_reprint" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(10) NOT NULL DEFAULT 'success',
    "error_msg" TEXT,

    CONSTRAINT "print_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_audit_logs" (
    "id" SERIAL NOT NULL,
    "order_id" UUID NOT NULL,
    "pk_no" VARCHAR(30) NOT NULL,
    "action" VARCHAR(20) NOT NULL,
    "acted_by" VARCHAR(10) NOT NULL,
    "acted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "diff" JSONB,

    CONSTRAINT "order_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "staff_code" VARCHAR(10),
    "email" VARCHAR(100) NOT NULL,
    "password_hash" VARCHAR(200) NOT NULL,
    "role" VARCHAR(20) NOT NULL DEFAULT 'staff',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_login" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "session_token" VARCHAR(255) NOT NULL,
    "user_id" UUID NOT NULL,
    "expires" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "products_jan_idx" ON "products"("jan");

-- CreateIndex
CREATE INDEX "products_cat_idx" ON "products"("cat");

-- CreateIndex
CREATE UNIQUE INDEX "product_aux_attrs_product_code_key" ON "product_aux_attrs"("product_code");

-- CreateIndex
CREATE UNIQUE INDEX "staff_emp_code_key" ON "staff"("emp_code");

-- CreateIndex
CREATE INDEX "staff_emp_code_idx" ON "staff"("emp_code");

-- CreateIndex
CREATE INDEX "shifts_date_idx" ON "shifts"("date");

-- CreateIndex
CREATE UNIQUE INDEX "shifts_date_staff_code_key" ON "shifts"("date", "staff_code");

-- CreateIndex
CREATE UNIQUE INDEX "printers_ip_address_key" ON "printers"("ip_address");

-- CreateIndex
CREATE UNIQUE INDEX "device_printer_map_device_code_key" ON "device_printer_map"("device_code");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_orders_pk_no_key" ON "shipping_orders"("pk_no");

-- CreateIndex
CREATE INDEX "shipping_orders_ship_date_status_idx" ON "shipping_orders"("ship_date", "status");

-- CreateIndex
CREATE INDEX "shipping_orders_deleted_at_idx" ON "shipping_orders"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_order_items_order_id_product_code_key" ON "shipping_order_items"("order_id", "product_code");

-- CreateIndex
CREATE UNIQUE INDEX "insp_sessions_order_id_key" ON "insp_sessions"("order_id");

-- CreateIndex
CREATE INDEX "member_assignments_date_staff_code_idx" ON "member_assignments"("date", "staff_code");

-- CreateIndex
CREATE INDEX "member_assignments_date_group_id_idx" ON "member_assignments"("date", "group_id");

-- CreateIndex
CREATE INDEX "order_audit_logs_order_id_idx" ON "order_audit_logs"("order_id");

-- CreateIndex
CREATE INDEX "order_audit_logs_acted_at_idx" ON "order_audit_logs"("acted_at");

-- CreateIndex
CREATE UNIQUE INDEX "users_staff_code_key" ON "users"("staff_code");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_session_token_key" ON "sessions"("session_token");

-- AddForeignKey
ALTER TABLE "product_aux_attrs" ADD CONSTRAINT "product_aux_attrs_product_code_fkey" FOREIGN KEY ("product_code") REFERENCES "products"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "set_comps" ADD CONSTRAINT "set_comps_fixed_box_code_fkey" FOREIGN KEY ("fixed_box_code") REFERENCES "boxes"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "set_comp_children" ADD CONSTRAINT "set_comp_children_set_comp_id_fkey" FOREIGN KEY ("set_comp_id") REFERENCES "set_comps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff" ADD CONSTRAINT "staff_employment_type_code_fkey" FOREIGN KEY ("employment_type_code") REFERENCES "employment_types"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff" ADD CONSTRAINT "staff_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "inspection_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff" ADD CONSTRAINT "staff_default_shift_pattern_fkey" FOREIGN KEY ("default_shift_pattern") REFERENCES "shift_patterns"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "std_times" ADD CONSTRAINT "std_times_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "inspection_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_staff_code_fkey" FOREIGN KEY ("staff_code") REFERENCES "staff"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_pattern_code_fkey" FOREIGN KEY ("pattern_code") REFERENCES "shift_patterns"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_printer_map" ADD CONSTRAINT "device_printer_map_device_code_fkey" FOREIGN KEY ("device_code") REFERENCES "devices"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_printer_map" ADD CONSTRAINT "device_printer_map_printer_code_fkey" FOREIGN KEY ("printer_code") REFERENCES "printers"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_orders" ADD CONSTRAINT "shipping_orders_carrier_code_fkey" FOREIGN KEY ("carrier_code") REFERENCES "carriers"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_orders" ADD CONSTRAINT "shipping_orders_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "thomas_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_order_items" ADD CONSTRAINT "shipping_order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "shipping_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_order_items" ADD CONSTRAINT "shipping_order_items_product_code_fkey" FOREIGN KEY ("product_code") REFERENCES "products"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insp_sessions" ADD CONSTRAINT "insp_sessions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "shipping_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insp_sessions" ADD CONSTRAINT "insp_sessions_staff_code_fkey" FOREIGN KEY ("staff_code") REFERENCES "staff"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insp_sessions" ADD CONSTRAINT "insp_sessions_device_code_fkey" FOREIGN KEY ("device_code") REFERENCES "devices"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insp_sessions" ADD CONSTRAINT "insp_sessions_box_code_fkey" FOREIGN KEY ("box_code") REFERENCES "boxes"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insp_logs" ADD CONSTRAINT "insp_logs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "insp_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thomas_imports" ADD CONSTRAINT "thomas_imports_imported_by_fkey" FOREIGN KEY ("imported_by") REFERENCES "staff"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_assignments" ADD CONSTRAINT "member_assignments_staff_code_fkey" FOREIGN KEY ("staff_code") REFERENCES "staff"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_assignments" ADD CONSTRAINT "member_assignments_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "inspection_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_logs" ADD CONSTRAINT "print_logs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "shipping_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_logs" ADD CONSTRAINT "print_logs_printer_code_fkey" FOREIGN KEY ("printer_code") REFERENCES "printers"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_logs" ADD CONSTRAINT "print_logs_device_code_fkey" FOREIGN KEY ("device_code") REFERENCES "devices"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_logs" ADD CONSTRAINT "print_logs_staff_code_fkey" FOREIGN KEY ("staff_code") REFERENCES "staff"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_audit_logs" ADD CONSTRAINT "order_audit_logs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "shipping_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_audit_logs" ADD CONSTRAINT "order_audit_logs_acted_by_fkey" FOREIGN KEY ("acted_by") REFERENCES "staff"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_staff_code_fkey" FOREIGN KEY ("staff_code") REFERENCES "staff"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
