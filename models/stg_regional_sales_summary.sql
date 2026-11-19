SELECT
    s.store_id,
    UPPER(s.region_name) AS region,
    COALESCE(SUM(o.order_total), 0) AS gross_revenue,
    COUNT(DISTINCT o.customer_id) AS unique_customers,
    CURRENT_DATE() AS report_date
FROM {{ ref('stg_stores') }} s
LEFT JOIN {{ ref('stg_orders') }} o
    ON s.store_id = o.store_id
WHERE s.is_active = 'Y'
GROUP BY 1, 2