-- DropForeignKey
ALTER TABLE "order_audit_logs" DROP CONSTRAINT "order_audit_logs_order_id_fkey";

-- DropForeignKey
ALTER TABLE "print_logs" DROP CONSTRAINT "print_logs_order_id_fkey";

-- AddForeignKey
ALTER TABLE "print_logs" ADD CONSTRAINT "print_logs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "shipping_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_audit_logs" ADD CONSTRAINT "order_audit_logs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "shipping_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
