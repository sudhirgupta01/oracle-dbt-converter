{{
    config(
        materialized='incremental',
        unique_key=['cust_id', 'reporting_qtr_start'],
        incremental_strategy='merge'
    )
}}

WITH customers AS (
    SELECT 
        cust_id,
        email
    FROM {{ ref('raw_customers') }}
),

credit_bureau AS (
    SELECT 
        cust_id,
        bureau_score
    FROM {{ ref('ext_credit_bureau') }}
),

fx_rates AS (
    SELECT 
        src_curr,
        rate_to_usd
    FROM {{ ref('ref_fx_rates') }}
),

filtered_transactions AS (
    SELECT 
        t.cust_id,
        t.txn_amount,
        t.channel_code,
        t.currency_code,
        t.txn_timestamp
    FROM {{ ref('raw_transactions') }} t
    WHERE t.txn_timestamp >= DATEADD(
        'month', 
        -3, 
        DATE_TRUNC('quarter', {{ var('run_date', 'CURRENT_DATE()') }}::DATE)
    )
),

customer_transactions AS (
    SELECT
        t.cust_id,
        ROUND(SUM(COALESCE(t.txn_amount, 0) * COALESCE(fx.rate_to_usd, 1)), 2) AS qtr_volume_usd,
        SUM(t.txn_amount) AS raw_total_amount,
        MAX_BY(t.channel_code, t.txn_timestamp) AS latest_channel
    FROM filtered_transactions t
    LEFT JOIN fx_rates fx
        ON t.currency_code = fx.src_curr
    GROUP BY t.cust_id
),

reporting_window AS (
    SELECT 
        DATEADD(
            'month', 
            -3, 
            DATE_TRUNC('quarter', {{ var('run_date', 'CURRENT_DATE()') }}::DATE)
        ) AS reporting_qtr_start
),

final AS (
    SELECT
        c.cust_id,
        SPLIT_PART(c.email, '@', 2) AS email_domain,
        COALESCE(b.bureau_score, 550) AS effective_score,
        COALESCE(ct.qtr_volume_usd, 0) AS qtr_volume_usd,
        ct.latest_channel,
        CASE 
            WHEN COALESCE(b.bureau_score, 550) < 600 AND COALESCE(ct.raw_total_amount, 0) > 50000 
                THEN 'HIGH_RISK'
            WHEN COALESCE(b.bureau_score, 550) BETWEEN 600 AND 720 
                THEN 'MEDIUM_RISK'
            ELSE 'LOW_RISK'
        END AS risk_tier,
        rw.reporting_qtr_start,
        CURRENT_TIMESTAMP() AS updated_at
    FROM customers c
    CROSS JOIN reporting_window rw
    LEFT JOIN credit_bureau b
        ON c.cust_id = b.cust_id
    LEFT JOIN customer_transactions ct
        ON c.cust_id = ct.cust_id
)

SELECT
    cust_id,
    email_domain,
    effective_score,
    qtr_volume_usd,
    latest_channel,
    risk_tier,
    reporting_qtr_start,
    updated_at
FROM final