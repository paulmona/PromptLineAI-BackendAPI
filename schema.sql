--
-- PostgreSQL database dump
--

\restrict c7kStDSfBXNrC0AVPa4ZnzglM5bdVUtS3JdLH8e3As8qhdbcLbgfnhokYoVoHSX

-- Dumped from database version 18.1 (Debian 18.1-1.pgdg13+2)
-- Dumped by pg_dump version 18.1 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: devices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.devices (
    id uuid NOT NULL,
    org_id uuid NOT NULL,
    user_id uuid,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    user_agent text,
    notes text
);


--
-- Name: events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.events (
    id uuid NOT NULL,
    org_id uuid NOT NULL,
    device_id uuid NOT NULL,
    user_id uuid,
    occurred_at timestamp with time zone NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    tool public.ai_tool NOT NULL,
    event_type public.ai_event_type NOT NULL,
    url_host text NOT NULL,
    file_ext text,
    file_size_kb integer,
    file_name text,
    prompt_len_bucket public.prompt_len_bucket,
    has_code_block boolean,
    paste_detected boolean,
    extra jsonb,
    CONSTRAINT events_file_size_nonneg_chk CHECK (((file_size_kb IS NULL) OR (file_size_kb >= 0)))
);


--
-- Name: orgs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orgs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: devices devices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_pkey PRIMARY KEY (id);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);


--
-- Name: orgs orgs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orgs
    ADD CONSTRAINT orgs_pkey PRIMARY KEY (id);


--
-- Name: devices_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX devices_org_id_idx ON public.devices USING btree (org_id);


--
-- Name: devices_org_last_seen_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX devices_org_last_seen_idx ON public.devices USING btree (org_id, last_seen_at DESC);


--
-- Name: devices_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX devices_user_id_idx ON public.devices USING btree (user_id);


--
-- Name: events_org_device_occurred_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_org_device_occurred_idx ON public.events USING btree (org_id, device_id, occurred_at DESC);


--
-- Name: events_org_occurred_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_org_occurred_idx ON public.events USING btree (org_id, occurred_at DESC);


--
-- Name: events_org_tool_occurred_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_org_tool_occurred_idx ON public.events USING btree (org_id, tool, occurred_at DESC);


--
-- Name: events_org_type_occurred_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_org_type_occurred_idx ON public.events USING btree (org_id, event_type, occurred_at DESC);


--
-- Name: events_org_user_occurred_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_org_user_occurred_idx ON public.events USING btree (org_id, user_id, occurred_at DESC);


--
-- Name: orgs_name_lower_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX orgs_name_lower_uq ON public.orgs USING btree (lower(name));


--
-- Name: devices devices_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: devices devices_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: events events_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id) ON DELETE CASCADE;


--
-- Name: events events_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.orgs(id) ON DELETE CASCADE;


--
-- Name: events events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--

\unrestrict c7kStDSfBXNrC0AVPa4ZnzglM5bdVUtS3JdLH8e3As8qhdbcLbgfnhokYoVoHSX

